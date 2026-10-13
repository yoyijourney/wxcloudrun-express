const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const axios = require("axios");
const { init: initDB, Counter } = require("./db");

const logger = morgan("tiny");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(logger);

// ============================================
// 何园知识库（先写死在代码里，后期可换数据库）
// ============================================
const knowledgeBase = {
    water_pavilion: {
        name: "水心亭",
        facts: [
            "水心亭建在水中央，是主人听戏的地方",
            "声音借水而清，借风而远",
            "何芷舠常在家宴时请戏班子在此唱戏"
        ]
    },
    pian_shi_shan_fang: {
        name: "片石山房",
        facts: [
            "片石山房是石涛和尚叠石作品",
            "石涛说“石有石性，水有水理，叠石如作画”",
            "后人称其为“天下第一山”"
        ]
    },
    boat_hall: {
        name: "船厅",
        facts: [
            "船厅外形像船，是何芷舠辞官归隐的心境写照",
            "他常在此待客，一壶茶，半日闲",
            "寓意“身在园中，心在江湖”"
        ]
    }
};

// 何芷舠角色提示词
const ROLE_PROMPT = `你是何芷舠，字汝持，安徽望江人，晚清道台，何园（寄啸山庄）的主人。
曾任湖北汉黄德道台，1883年辞官归隐扬州，建何园。
你是一个儒雅、内敛、有士大夫气的人。
说话第一人称，称游客为“客”或“阁下”，语气平和从容。
用词偏文雅，但不掉书袋，偶尔引用陶渊明、苏轼。
不讲现代词汇，不玩网络梗。
回答控制在3句话内。
不编造历史，不评价现代政治，不说1883年以后的事。`;

// 根据景点 ID 获取知识库上下文
function getKnowledgeContext(spotId) {
    const spot = knowledgeBase[spotId];
    if (!spot) return "";
    return `当前景点：${spot.name}\n已知事实：\n${spot.facts.join("\n")}`;
}

// ============================================
// 首页
// ============================================
app.get("/", async (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// ============================================
// 更新计数（保留模板原有功能）
// ============================================
app.post("/api/count", async (req, res) => {
    const { action } = req.body;
    if (action === "inc") {
        await Counter.create();
    } else if (action === "clear") {
        await Counter.destroy({
            truncate: true,
        });
    }
    res.send({
        code: 0,
        data: await Counter.count(),
    });
});

// 获取计数
app.get("/api/count", async (req, res) => {
    const result = await Counter.count();
    res.send({
        code: 0,
        data: result,
    });
});

// ============================================
// 小程序调用，获取微信 Open ID（保留）
// ============================================
app.get("/api/wx_openid", async (req, res) => {
    if (req.headers["x-wx-source"]) {
        res.send(req.headers["x-wx-openid"]);
    }
});

// ============================================
// 【新增】AI 问答接口
// ============================================
app.post("/api/chat", async (req, res) => {
    try {
        const { question, spotId, history = [] } = req.body;

        if (!question) {
            return res.status(400).json({ code: -1, msg: "question 不能为空" });
        }

        // 1. 获取知识库上下文
        const context = getKnowledgeContext(spotId);

        // 2. 组装 system prompt
        const systemPrompt = context
            ? `${ROLE_PROMPT}\n\n${context}`
            : ROLE_PROMPT;

        // 3. 组装 messages
        const messages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: question }
        ];

        // 4. 调用 DeepSeek API
        const response = await axios.post(
            "https://api.deepseek.com/chat/completions",
            {
                model: "deepseek-chat",
                messages,
                temperature: 0.7,
                max_tokens: 300
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
                }
            }
        );

        const answer = response.data.choices?.[0]?.message?.content || "抱歉，我没能回答上来。";

        res.json({
            code: 0,
            data: { answer }
        });

    } catch (err) {
        console.error("chat 接口错误：", err);
        res.status(500).json({ code: -1, msg: "服务器内部错误" });
    }
});

// ============================================
// 启动
// ============================================
const port = process.env.PORT || 80;

async function bootstrap() {
    await initDB();
    app.listen(port, () => {
        console.log("启动成功", port);
    });
}

bootstrap();