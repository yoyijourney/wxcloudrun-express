const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const axios = require("axios");
const tencentcloud = require("tencentcloud-sdk-nodejs-tts");

const { init: initDB, Counter } = require("./db");
const logger = morgan("tiny");

// ============================================
// 腾讯云 TTS 客户端
// ============================================
const TtsClient = tencentcloud.tts.v20190823.Client;

const ttsClient = new TtsClient({
    credential: {
        secretId: process.env.TENCENT_SECRET_ID,
        secretKey: process.env.TENCENT_SECRET_KEY
    },
    region: "ap-guangzhou",
    profile: {
        httpProfile: {
            endpoint: "tts.tencentcloudapi.com"
        }
    }
});

// ============================================
// Express 初始化
// ============================================
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "10mb" }));
app.use(cors());
app.use(logger);

// ============================================
// 角色列表
// ============================================
const ROLES = [
    {
        id: "hezhidao",
        name: "何芷舠",
        title: "何园主人",
        avatar: "/images/roles/hezhidao.png",
        personality: "儒雅、内敛、有士大夫气",
        greeting: "客，欢迎来到寄啸山庄。"
    },
    {
        id: "hejiada",
        name: "何家大小姐",
        title: "何芷舠之女",
        avatar: "/images/roles/hejiada.png",
        personality: "温婉、知性、大家闺秀",
        greeting: "客，请随我来。"
    },
    {
        id: "shitao",
        name: "石涛",
        title: "叠石名家",
        avatar: "/images/roles/shitao.png",
        personality: "狂放、艺术气、不拘礼节",
        greeting: "贫僧叠的山，你可看得懂？"
    }
];

// ============================================
// 场景与景点（只存基础信息，讲解词动态生成）
// ============================================
const SCENES = [
    {
        id: "corridor",
        name: "复道回廊",
        panorama: "/images/scenes/corridor.jpg",
        spots: ["water_pavilion", "pian_shi_shan_fang", "boat_hall"]
    }
];

const SPOTS = [
    {
        id: "water_pavilion",
        sceneId: "corridor",
        name: "水心亭",
        position: { x: 0.5, y: 0.6 }
    },
    {
        id: "pian_shi_shan_fang",
        sceneId: "corridor",
        name: "片石山房",
        position: { x: 0.3, y: 0.5 }
    },
    {
        id: "boat_hall",
        sceneId: "corridor",
        name: "船厅",
        position: { x: 0.7, y: 0.55 }
    }
];

// ============================================
// 何园知识库
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

// ============================================
// 角色提示词
// ============================================
const ROLE_PROMPTS = {
    hezhidao: `你是何芷舠，字汝持，安徽望江人，晚清道台，何园（寄啸山庄）的主人。
曾任湖北汉黄德道台，1883年辞官归隐扬州，建何园。
你是一个儒雅、内敛、有士大夫气的人。
说话第一人称，称游客为“客”或“阁下”，语气平和从容。
用词偏文雅，但不掉书袋，偶尔引用陶渊明、苏轼。
不讲现代词汇，不玩网络梗。
回答控制在3句话内。
不编造历史，不评价现代政治，不说1883年以后的事。`,

    hejiada: `你是何家大小姐，何芷舠的女儿，生长在何园。
你温婉知性，读过书，见过世面，说话轻声细语但有主见。
你熟悉园中日常：读书、听戏、赏花、待客。
说话第一人称，称游客为“客”。
回答控制在3句话内，不编造历史，不评价现代政治。`,

    shitao: `你是石涛和尚，明末清初画家，画坛“四僧”之一，叠石名家。
你狂放不羁，艺术气十足，说话直率，不拘礼节。
你曾为何园叠片石山房，主张“石有石性，水有水理，叠石如作画”。
说话第一人称，可用“贫僧”“老衲”自称。
回答控制在3句话内，不编造历史，不评价现代政治。`
};

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
// 计数接口（模板原有）
// ============================================
app.post("/api/count", async (req, res) => {
    const { action } = req.body;
    if (action === "inc") {
        await Counter.create();
    } else if (action === "clear") {
        await Counter.destroy({ truncate: true });
    }
    res.send({ code: 0, data: await Counter.count() });
});

app.get("/api/count", async (req, res) => {
    const result = await Counter.count();
    res.send({ code: 0, data: result });
});

// ============================================
// 获取微信 OpenID（模板原有）
// ============================================
app.get("/api/wx_openid", async (req, res) => {
    if (req.headers["x-wx-source"]) {
        res.send(req.headers["x-wx-openid"]);
    }
});

// ============================================
// 角色列表接口
// ============================================
app.get("/api/roles", async (req, res) => {
    res.json({ code: 0, data: ROLES });
});

// ============================================
// 场景接口
// ============================================
app.get("/api/scenes", async (req, res) => {
    res.json({ code: 0, data: SCENES });
});

// 获取某个场景下的所有景点
app.get("/api/scenes/:sceneId/spots", async (req, res) => {
    const { sceneId } = req.params;
    const spots = SPOTS.filter(s => s.sceneId === sceneId);
    res.json({ code: 0, data: spots });
});

// 获取单个景点详情
app.get("/api/spots/:spotId", async (req, res) => {
    const { spotId } = req.params;
    const spot = SPOTS.find(s => s.id === spotId);
    if (!spot) {
        return res.status(404).json({ code: -1, msg: "景点不存在" });
    }
    res.json({ code: 0, data: spot });
});

// ============================================
// 【新增】讲解词生成接口（按 景点 + 角色 动态生成）
// ============================================
app.post("/api/narration", async (req, res) => {
    try {
        const { spotId, roleId = "hezhidao" } = req.body;

        // 1. 取景点知识
        const context = getKnowledgeContext(spotId);
        if (!context) {
            return res.status(404).json({ code: -1, msg: "景点不存在" });
        }

        // 2. 取角色提示词
        const rolePrompt = ROLE_PROMPTS[roleId] || ROLE_PROMPTS.hezhidao;

        // 3. 让角色用自己的口吻介绍这个景点
        const messages = [
            {
                role: "system",
                content: `${rolePrompt}\n\n${context}\n\n请用你的口吻，向游客介绍这个景点。控制在3句话内。`
            },
            {
                role: "user",
                content: "请介绍一下这里。"
            }
        ];

        const response = await axios.post(
            "https://api.deepseek.com/chat/completions",
            {
                model: "deepseek-chat",
                messages,
                temperature: 0.8,
                max_tokens: 300
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
                }
            }
        );

        const narration = response.data.choices?.[0]?.message?.content || "";

        res.json({
            code: 0,
            data: { narration, roleId, spotId }
        });

    } catch (err) {
        console.error("narration 接口错误：", err.response?.data || err.message);
        res.status(500).json({ code: -1, msg: "生成讲解失败" });
    }
});

// ============================================
// AI 问答接口
// ============================================
app.post("/api/chat", async (req, res) => {
    try {
        const { question, spotId, roleId = "hezhidao", history = [] } = req.body;

        if (!question) {
            return res.status(400).json({ code: -1, msg: "question 不能为空" });
        }

        const context = getKnowledgeContext(spotId);
        const rolePrompt = ROLE_PROMPTS[roleId] || ROLE_PROMPTS.hezhidao;

        const systemPrompt = context
            ? `${rolePrompt}\n\n${context}`
            : rolePrompt;

        const messages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: question }
        ];

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

        res.json({ code: 0, data: { answer, roleId } });

    } catch (err) {
        console.error("chat 接口错误：", err.response?.data || err.message);
        res.status(500).json({ code: -1, msg: "服务器内部错误" });
    }
});

// ============================================
// TTS 语音合成接口（直接返回 base64）
// ============================================
const ROLE_VOICE_MAP = {
    hezhidao: 101021,   // 何芷舠 - 智瑞
    hejiada: 402000,    // 何家大小姐 - 云晓芙
    shitao: 101054      // 石涛 - 智友
};

app.post("/api/tts", async (req, res) => {
    try {
        const { text, roleId } = req.body;

        if (!text) {
            return res.status(400).json({ code: -1, msg: "text 不能为空" });
        }

        const voiceType = ROLE_VOICE_MAP[roleId] || ROLE_VOICE_MAP.hezhidao;

        const result = await ttsClient.TextToVoice({
            Text: text,
            SessionId: Date.now().toString(),
            VoiceType: voiceType,
            Codec: "mp3",
            SampleRate: 16000
        });

        res.json({
            code: 0,
            data: {
                audioBase64: result.Audio,
                format: "mp3"
            }
        });

    } catch (err) {
        console.error("TTS 接口错误：", err.response?.data || err.message);
        res.status(500).json({ code: -1, msg: "语音合成失败" });
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