# 视频知识总结 Agent 系统 — 设计文档

## 一、项目概述（video knowedge summary）

**核心目标**：不想看视频，输入 URL → 自动下载字幕 → Agent 系统总结知识点 → 生成知识框架图 → 在页面上展示。

**技术选型**：

| 层次 | 技术 | 说明 |
|------|------|------|
| 后端框架 | FastAPI + Uvicorn | 异步支持好，适合 IO 密集型 |
| 大模型 | DeepSeek (`deepseek-v4flash`) | OpenAI 兼容 API，中文能力强 |
| Agent 框架 | LangGraph | 状态图编排，多 Agent 协作，审核循环 |
| 前端 | React + Vite + Tailwind | SPA |
| 数据库 | SQLite（开发期） | |
| 字幕获取 | yt-dlp + 平台 API | 多平台适配器模式 |
| 可视化 | Mermaid.js | 知识框架图渲染 |
| 部署 | Docker + docker-compose | |

---

## 二、核心业务流程

### 2.1 总体流程

> **架构原则**：LangGraph 仅编排 LLM 相关的核心工作流（提取→审核⇄修正→框架构建），确定性操作（URL 解析、字幕下载、Mermaid 模板生成）放在图外作为前置/后置步骤。图的职责是"指挥"而非"干活"。

```
用户输入URL
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│                    FastAPI 层（图外前置）                       │
│                                                              │
│  ┌──────────────────────────────┐                            │
│  │  1. URL 解析 (video_resolver) │  识别平台，获取视频/合集信息  │
│  │     系统做：平台识别           │  → 返回分P列表               │
│  │     用户做：选择单集/合集      │  ← 用户显式选择（不由LLM判断） │
│  └────────────┬─────────────────┘                            │
│               │                                              │
│               ▼                                              │
│  ┌──────────────────────────────┐                            │
│  │  2. 用户选择                   │                            │
│  │     ├── 单集：直接开始         │                            │
│  │     └── 合集：选择某一集 or 全合集总结                        │
│  └────────────┬─────────────────┘                            │
│               │                                              │
│               ▼                                              │
│  ┌──────────────────────────────┐                            │
│  │  3. 字幕获取                   │  平台适配器下载字幕           │
│  │     (platform/services/)     │  → 保存到文件/DB             │
│  └────────────┬─────────────────┘                            │
│               │                                              │
│               │  字幕文本 + 视频元信息作为 State 传入图            │
└───────────────┼──────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│                  LangGraph Agent 层（图内编排）                  │
│                                                              │
│  ┌──────────────────────────────┐                            │
│  │  4. 知识点提取 (Map)           │  多视角并行提取              │
│  │     阶段A: 字幕过长时自动切分   │  ← 详见 §5.4.5              │
│  └────────────┬─────────────────┘                            │
│               │                                              │
│               ▼                                              │
│  ┌──────────────────────────────┐                            │
│  │  5. 质量审核 ⇄ 修正 (审核循环)  │  批判性审查 + 最多3次重试    │
│  │     阶段B: 多Agent审核修正      │                            │
│  └────────────┬─────────────────┘                            │
│               │                                              │
│               ▼                                              │
│  ┌──────────────────────────────┐                            │
│  │  6. 知识框架构建 (Reduce)      │  去重→分层→标注依赖          │
│  │     阶段C: 知识框架构建        │                            │
│  └────────────┬─────────────────┘                            │
│               │                                              │
└───────────────┼──────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│                    FastAPI 层（图外后置）                       │
│                                                              │
│  ┌──────────────────────────────┐                            │
│  │  7. Mermaid 框架图生成         │  纯模板引擎，不涉及 LLM       │
│  │     阶段D: Mermaid 框架图生成  │                            │
│  └────────────┬─────────────────┘                            │
│               │                                              │
│               ▼                                              │
│  ┌──────────────────────────────┐                            │
│  │  8. 结果展示                   │                            │
│  │     ├── 概括框架图（3层）      │                            │
│  │     ├── 详细知识树（完整展开）  │                            │
│  │     └── 知识点依赖关系图       │                            │
│  └──────────────────────────────┘                            │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 合集处理流程（Map-Reduce + Agent 协作）

```
合集（如：黑马C++ 200集）
    │
    ├── 阶段1: 逐集下载字幕（可并发）
    │
    ├── 阶段2: 逐集知识点提取（可并发，Semaphore 控制）
    │   ├── 第1集 → 提取Agent → [指针, 变量, 数据类型...]
    │   ├── 第2集 → 提取Agent → [循环, 条件判断...]
    │   └── ...
    │
    ├── 阶段3: 按章节分批 Reduce
    │   ├── 第1-20集（基础语法）→ Reduce → 第1章知识点
    │   ├── 第21-40集（面向对象）→ Reduce → 第2章知识点
    │   └── ...
    │
    ├── 阶段4: 质量审核循环
    │   审核Agent 审查 → 不通过 → 修正Agent 修改 → 再审...
    │
    └── 阶段5: 最终汇总 → 完整知识框架 + Mermaid 图
```

---

## 三、Agent 系统架构

### 3.1 整体架构图

> **分层原则**：`platform/` 层包含纯业务逻辑（无 LangGraph 依赖），Agent 编排层仅负责 LLM 工作流的调度与状态管理。两层之间通过 State 初始值 + Tool 接口解耦。

```
┌─────────────────────────────────────────────────────────────┐
│                    前端 (React + Vite)                       │
│   URL输入 → 用户选择(单集/合集) → 进度 → 框架图 → 对话追问   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP REST + WebSocket
┌──────────────────────────────▼──────────────────────────────┐
│                      FastAPI 应用层                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              API 路由 (api/)                           │   │
│  │  video.py · task.py · summary.py · history.py         │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │                                    │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │         LangGraph Agent 编排层 (agent_framework/)      │   │
│  │                                                       │   │
│  │  ┌─────────────────────────────────────────────┐     │   │
│  │  │          主控 Supervisor                      │     │   │
│  │  │   接收 State → 调度子Agent → 返回结果          │     │   │
│  │  └──────────────────┬──────────────────────────┘     │   │
│  │                     │                                 │   │
│  │  ┌──────────────────▼──────────────────────────┐     │   │
│  │  │          LLM Agent 集群（4 节点）              │     │   │
│  │  │                                              │     │   │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐     │     │   │
│  │  │  │知识点    │ │质量审核  │ │修正      │     │     │   │
│  │  │  │提取Agent │ │Agent     │ │Agent     │     │     │   │
│  │  │  │(多视角)  │ │(批判审查) │ │(定向修复) │     │     │   │
│  │  │  └──────────┘ └──────────┘ └──────────┘     │     │   │
│  │  │  ┌──────────┐                               │     │   │
│  │  │  │知识框架  │                               │     │   │
│  │  │  │Agent     │                               │     │   │
│  │  │  └──────────┘                               │     │   │
│  │  └──────────────────────────────────────────────┘     │   │
│  │                                                       │   │
│  │  ┌──────────────────────────────────────────────┐     │   │
│  │  │        状态持久化 (LangGraph Checkpointer)      │     │   │
│  │  │  会话状态 · 执行历史 · 缓存 · 断点续传          │     │   │
│  │  └──────────────────────────────────────────────┘     │   │
│  └───────────────────────────────────────────────────────┘   │
│                         │                                    │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │          业务支撑层 (platform/)  ← 无 LangGraph 依赖    │   │
│  │                                                       │   │
│  │  ┌────────────┐ ┌────────────┐ ┌──────────────┐      │   │
│  │  │ 视频解析   │ │ 字幕获取   │ │ Mermaid 生成 │      │   │
│  │  │ (纯正则)   │ │ (适配器)   │ │ (模板引擎)   │      │   │
│  │  └────────────┘ └────────────┘ └──────────────┘      │   │
│  │  ┌────────────┐ ┌────────────┐                       │   │
│  │  │ 文本切分   │ │ 搜索工具   │                       │   │
│  │  │ (语义分段) │ │ (可选)     │                       │   │
│  │  └────────────┘ └────────────┘                       │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              数据层 (models/)                          │   │
│  │  SQLite · ORM (video_sources, episodes, summaries,   │   │
│  │  tasks)                                                │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 LangGraph 状态图设计

图中仅保留 LLM 相关节点（4 个节点 + 1 个条件边）。视频解析、字幕下载在图外完成，结果通过 State 初始值传入。Mermaid 生成在图外以纯模板方式完成。

```
                           STATE 输入
                     (字幕文本 + 视频元信息)
                               │
                               ▼
                        ┌──────────────┐
                        │   知识点提取   │  ← 3 个视角 Agent 并行
                        │ extract       │    字幕过长时自动触发切分→Map-Reduce
                        │ knowledge     │    （详见 §5.4.5）
                        └──────┬───────┘
                               │
                               ▼
                        ┌──────────────┐
                        │   质量审核     │  ← 批判性审查
                        │ review        │    评分 + 问题列表
                        │ quality       │
                        └──┬───────┬────┘
                           │       │
              ┌────────────┘       └────────────┐
              ▼                                 ▼
     ┌──────────────┐                  ┌──────────────┐
     │  通过(≥80分)  │                  │  不通过       │
     └──────┬───────┘                  └──────┬───────┘
            │                                 │
            │                          ┌──────────────┐
            │                          │   修正知识     │  ← 根据审核意见修改
            │                          │ revise        │   补充遗漏、修正错误
            │                          │ knowledge     │
            │                          └──────┬───────┘
            │                                 │
            │                     retry_count < 3 ?
            │                      │           │
            │                   ┌──┘           └──┐
            │                   ▼ (回到审核)      ▼ (超过重试次数)
            │              [review_quality]  [build_framework]
            │
            └──────────────────┬────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │   框架构建     │  ← 去重→分层→标注依赖→区分核心/进阶
                        │ build         │
                        │ framework     │
                        └──────┬───────┘
                               │
                               ▼
                           STATE 输出
                     (knowledge_framework)
                               │
                               ▼
                     ┌────────────────────┐
                     │ 图外后置：Mermaid 生成 │  ← 纯模板引擎，不涉及 LLM
                     │ generate_mermaid      │
                     └───────────────────────┘
```

**关键区别**（相比旧设计的简化）：

| 变动 | 原因 |
|------|------|
| `resolve_video` 移出 | 纯 URL 正则匹配，无分支、无状态依赖 |
| `download_subtitles` 移出 | IO 密集型长操作，耗时不稳定，阻塞图事件循环 |
| `generate_mermaid` 移出 | 纯 data→text 模板转换，无 LLM 调用 |
| 图内仅 4 个 LLM 节点 | 每个节点都是 LLM 调用，编排价值最大化 |

### 3.3 质量审核循环（核心优化）

这是 Agent 系统相比固定 Pipeline 最大的优势点：

```
                    字幕文本
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │提取Agent1│ │提取Agent2│ │提取Agent3│    3个不同视角
    │侧重:概念  │ │侧重:实践  │ │侧重:关联  │    并行提取
    └────┬─────┘ └────┬─────┘ └────┬─────┘
         │            │            │
         └──────┬─────┘            │
                │                  │
           ┌────▼────┐             │
           │合并Agent │◄───────────┘
           └────┬────┘
                │
           ┌────▼────┐
           │审核Agent │  批判性审查:
           │         │  ├── 有遗漏的知识点吗？
           │         │  ├── 有错误理解吗？
           │         │  ├── 难度标注合理吗？
           │         │  └── 前置依赖正确吗？
           └──┬──┬──┘
              │  │
      ┌───────┘  └───────┐
      ▼                  ▼
┌──────────┐      ┌──────────┐
│ 合格(≥80)│      │ 不合格    │
└────┬─────┘      └────┬─────┘
     │                 │
     │            ┌────▼─────┐
     │            │修正Agent  │  根据审核意见修改
     │            └────┬─────┘  (max 3 次重试)
     │                 │
     └────────┬────────┘
              │
         ┌────▼────┐
         │最终输出  │
         └─────────┘
```

### 3.4 对话追问 Agent（Phase 4）

总结完成后，用户可与知识体系对话：

```
用户: "我不太理解'虚函数表'这个概念"
    → 对话Agent 查找对应知识点 → 结合字幕原文展开解释

用户: "这个和前面的'多态'有什么关系？"
    → 对话Agent 查询知识框架中的依赖关系 → 解释关联

用户: "这个知识点在视频的哪个位置？"
    → 对话Agent 回溯字幕时间戳 → 告知具体集数和时间
```

---

## 四、项目目录结构

```
vksummary/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                      # FastAPI 入口，路由注册
│   │   ├── config.py                    # Settings 配置管理 (.env)
│   │   │
│   │   ├── api/                         # API 路由层
│   │   │   ├── __init__.py
│   │   │   ├── video.py                 # POST /api/video/resolve
│   │   │   ├── task.py                  # POST /api/task/summarize, GET status, WS
│   │   │   ├── summary.py               # GET /api/summary/{id}, 导出
│   │   │   └── history.py               # GET/DELETE /api/history
│   │   │
│   │   ├── agent_framework/             # LangGraph Agent 编排层（仅 LLM 工作流）
│   │   │   ├── __init__.py
│   │   │   ├── supervisor.py            # 主控 Supervisor Agent
│   │   │   ├── state.py                 # LangGraph State 定义（仅 LLM 相关字段）
│   │   │   ├── graph.py                 # 状态图构建（4 节点 + 1 条件边）
│   │   │   ├── checkpointer.py          # 状态持久化（断点续传）
│   │   │   │
│   │   │   ├── agents/                  # 子 Agent 定义（4 个 LLM Agent）
│   │   │   │   ├── __init__.py
│   │   │   │   ├── extract_agent.py     # 知识点提取Agent（多视角，含超长字幕切分调度）
│   │   │   │   ├── review_agent.py      # 质量审核Agent
│   │   │   │   ├── revise_agent.py      # 修正Agent
│   │   │   │   ├── framework_agent.py   # 知识框架构建Agent
│   │   │   │   └── conversation_agent.py # 对话追问Agent（Phase 4）
│   │   │   │
│   │   │   ├── tools/                   # 工具层（供 Agent 调用，纯接口封装）
│   │   │   │   ├── __init__.py
│   │   │   │   ├── knowledge_tools.py   # 知识点 CRUD 工具
│   │   │   │   └── search_tools.py      # 搜索补充资料工具（可选）
│   │   │   │
│   │   │   └── prompts/                 # Agent Prompt 模板
│   │   │       ├── __init__.py
│   │   │       ├── extract_prompts.py   # 提取相关 Prompt
│   │   │       ├── review_prompts.py    # 审核相关 Prompt
│   │   │       ├── framework_prompts.py # 框架构建 Prompt
│   │   │       └── conversation_prompts.py # 对话 Prompt
│   │   │
│   │   ├── platform/                    # 业务支撑层（不引入 LangGraph 依赖）
│   │   │   ├── __init__.py
│   │   │   │
│   │   │   ├── core/                    # 纯函数，框架无关，可独立测试
│   │   │   │   ├── __init__.py
│   │   │   │   ├── text_splitter.py     # 语义文本切分（SRT 时间戳 + 段落边界）
│   │   │   │   ├── mermaid_generator.py # Mermaid 模板渲染（纯 data→text）
│   │   │   │   └── url_parser.py        # URL 平台识别（纯正则）
│   │   │   │
│   │   │   └── services/                # 外部依赖封装（IO 操作）
│   │   │       ├── __init__.py
│   │   │       ├── video_resolver.py    # URL 解析，平台识别，信息提取
│   │   │       ├── task_manager.py      # 任务创建、调度、进度管理
│   │   │       └── subtitle_fetcher/    # 字幕获取适配器
│   │   │           ├── __init__.py
│   │   │           ├── base.py          # 抽象基类
│   │   │           ├── bilibili.py      # B站适配器
│   │   │           ├── youtube.py       # YouTube 适配器
│   │   │           ├── generic.py       # yt-dlp 通用兜底
│   │   │           └── factory.py       # 工厂方法
│   │   │
│   │   ├── models/                      # 数据层
│   │   │   ├── __init__.py
│   │   │   ├── database.py              # SQLAlchemy engine + session
│   │   │   └── schema.py               # ORM Model（4张表）
│   │   │
│   │   └── utils/                       # 通用工具
│   │       ├── __init__.py
│   │       └── token_counter.py         # Token 计数（判断是否需要切分）
│   │
│   ├── data/
│   │   ├── subtitles/                   # 字幕文件
│   │   ├── vksummary.db                 # SQLite 数据库
│   │   └── checkpoints.db               # LangGraph 状态持久化
│   │
│   ├── requirements.txt
│   └── Dockerfile

├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx                      # 路由
│   │   ├── index.css                    # Tailwind
│   │   │
│   │   ├── pages/
│   │   │   ├── HomePage.jsx             # URL 输入 + 单集/合集选择
│   │   │   ├── TaskPage.jsx             # 任务进度页
│   │   │   ├── SummaryPage.jsx          # 总结结果（框架图+知识树）
│   │   │   └── HistoryPage.jsx          # 历史记录
│   │   │
│   │   ├── components/
│   │   │   ├── URLInput.jsx             # URL 输入框
│   │   │   ├── VideoSelector.jsx        # 合集选择器（用户显式选择）
│   │   │   ├── ProgressTracker.jsx      # 进度条（WebSocket）
│   │   │   ├── KnowledgeGraph.jsx       # Mermaid 框架图渲染
│   │   │   ├── KnowledgeTree.jsx        # 详细知识树（递归组件）
│   │   │   ├── KnowledgeCard.jsx        # 知识点卡片
│   │   │   ├── SummaryOverview.jsx      # 概括视图
│   │   │   ├── SummaryDetail.jsx        # 详细视图
│   │   │   ├── ExportMenu.jsx           # 导出 MD/PDF
│   │   │   └── HistoryList.jsx          # 历史列表
│   │   │
│   │   ├── hooks/
│   │   │   ├── useWebSocket.js
│   │   │   └── useApi.js
│   │   │
│   │   └── api/
│   │       └── client.js                # API 封装
│   │
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── Dockerfile

├── docker-compose.yml
└── README.md
```

---

## 五、核心模块详细设计

### 5.1 `app/config.py` — 配置管理

```
配置项：
├── DEEPSEEK_API_KEY          # DeepSeek API 密钥，必填
├── DEEPSEEK_BASE_URL         # API 地址，默认 https://api.deepseek.com/v1
├── DEEPSEEK_MODEL            # 模型名，默认 deepseek-v4flash
├── DATABASE_URL              # 数据库连接，默认 sqlite:///./data/vksummary.db
├── CHECKPOINT_DB_URL         # LangGraph 状态持久化，默认 sqlite:///./data/checkpoints.db
├── SUBTITLE_DIR              # 字幕存储目录，默认 ./data/subtitles
├── MAX_CONCURRENT_TASKS      # 最大并发任务数，默认 3
├── MAX_RETRY_COUNT           # 审核修正最大重试次数，默认 3
├── QUALITY_THRESHOLD         # 审核通过阈值，默认 0.8
├── BILIBILI_COOKIE           # B站 cookie（可选）
└── LOG_LEVEL                 # 日志级别
```

### 5.2 `models/schema.py` — 数据库设计

4 张核心表：

```
video_sources（视频源）
├── id              INTEGER PRIMARY KEY AUTOINCREMENT
├── url             TEXT NOT NULL
├── platform        TEXT       bilibili / youtube / other
├── source_type     TEXT       single / playlist
├── title           TEXT
├── description     TEXT
├── total_episodes  INTEGER
├── thumbnail       TEXT
└── created_at      DATETIME

episodes（单集信息）
├── id              INTEGER PRIMARY KEY AUTOINCREMENT
├── source_id       FK → video_sources.id
├── episode_index   INTEGER
├── title           TEXT
├── url             TEXT
├── subtitle_path   TEXT       字幕文件本地路径（可空）
├── subtitle_text   TEXT       字幕全文（可空）
├── subtitle_status TEXT       manual / auto / none / failed
├── duration        INTEGER    时长（秒）
└── created_at      DATETIME

summaries（总结结果）
├── id              INTEGER PRIMARY KEY AUTOINCREMENT
├── source_id       FK → video_sources.id
├── episode_id      FK → episodes.id（NULL=合集总结）
├── summary_type    TEXT       overview / detailed / single
├── knowledge_points JSON     知识点列表
├── knowledge_tree  JSON       知识树结构
├── mermaid_overview TEXT      概括框架图代码
├── mermaid_detailed TEXT      详细框架图代码
├── mermaid_deps    TEXT       依赖关系图代码
└── created_at      DATETIME

tasks（任务记录）
├── id              TEXT PRIMARY KEY  UUID
├── source_id       FK
├── status          TEXT       pending / fetching / extracting / reviewing / building / completed / failed
├── progress        REAL       0.0 ~ 1.0
├── current_step    TEXT
├── error_message   TEXT
├── result_summary_id FK
├── langgraph_state TEXT       LangGraph checkpoint 引用
├── created_at      DATETIME
└── finished_at     DATETIME
```

### 5.3 `platform/services/subtitle_fetcher/` — 字幕获取模块

保持适配器模式，新增字幕可用性检测和文件组织规范。

#### 5.3.1 字幕文件存储规范

```
data/subtitles/
├── {source_id}/                    # 一个视频源（合集）一个文件夹
│   ├── episode_001.srt             # 一集一个字幕文件
│   ├── episode_002.srt
│   ├── episode_003.srt
│   └── ...
├── {source_id_2}/                  # 另一个视频源
│   └── episode_001.srt
└── ...
```

**设计理由**：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **一集一文件（✅ 采用）** | 可并行下载/处理；失败可单集重试；按集清理；Map-Reduce 天然对齐 | 文件数量多（200 集 = 200 个文件） |
| 多集合一文件 | 文件少 | 无法并行处理；单集失败污染全部；切分依赖不可靠的文本标记 |

#### 5.3.2 适配器基类（扩展）

```python
from enum import Enum

class SubtitleStatus(str, Enum):
    MANUAL = "manual"            # 人工字幕（创作者/社区上传），质量最高
    AUTO = "auto"                # 平台自动生成字幕（AI 字幕），可能有少量错误
    NONE_AVAILABLE = "none"      # 无字幕可用
    DOWNLOAD_FAILED = "failed"   # 有字幕但下载失败（网络/权限问题）

class SubtitleResult:
    episode_index: int
    url: str
    status: SubtitleStatus       # 字幕可用性状态
    file_path: str | None        # 本地文件路径（status 非 NONE 时有效）
    format: str | None           # srt / vtt / txt
    language: str                # zh-Hans / en / ja ...
    text: str | None             # 字幕全文（小文件直接加载到内存）

class BaseFetcher(ABC):
    @staticmethod
    @abstractmethod
    def can_handle(url: str) -> bool: ...

    @abstractmethod
    async def extract_info(self, url: str) -> VideoSourceInfo: ...

    @abstractmethod
    async def check_subtitle_availability(self, url: str) -> SubtitleStatus:
        """
        检测字幕是否可用（不下载，仅探测）。
        这是关键步骤 —— 在下载前先判断，避免无效下载。
        """
        ...

    @abstractmethod
    async def download_subtitle(
        self, url: str, output_dir: str, episode_index: int
    ) -> SubtitleResult: ...

    @abstractmethod
    async def download_playlist_subtitles(
        self, urls: list[str], output_dir: str,
        progress_callback: Callable,
        skip_no_subtitle: bool = True   # 默认跳过无字幕的集
    ) -> list[SubtitleResult]: ...
```

#### 5.3.3 字幕可用性检测策略

检测发生在**下载之前**，避免无效 IO：

```
对每个视频 URL：
    │
    ├── 1. 平台 API 检查（最快）
    │   B站: API 返回 subtitle 字段 → 直接知道有没有字幕
    │   YouTube: yt-dlp --list-subs → 列出所有可用字幕轨道
    │
    ├── 2. 判断结果
    │   ├── 有人工字幕 (zh-Hans)        → status=MANUAL, 优先下载
    │   ├── 有自动字幕 (zh-Hans, en)    → status=AUTO, 备选下载
    │   ├── 仅有非中文自动字幕 (en/ja)   → status=AUTO, 标记语言（LLM 可理解英文）
    │   └── 无任何字幕                  → status=NONE_AVAILABLE
    │
    └── 3. 记录到 episodes 表
        subtitle_status 字段: manual / auto / none / failed
```

**各平台检测要点**：

| 平台 | 检测方式 | 说明 |
|------|---------|------|
| B站 | API 响应中的 `subtitle` 字段 | `subtitle.subtitles` 数组为空 = 无字幕 |
| YouTube | `yt-dlp --list-subs --skip-download` | 解析输出，查找 `zh-Hans` 或 `en` 语言轨道 |
| 通用 | `yt-dlp --list-subs --skip-download` | 同上，按语言优先级匹配 |
| 所有平台 | 下载后验证 | 文件存在 + 大小 > 0 + 文本非空（兜底校验） |

#### 5.3.4 无字幕的处理策略

```
字幕检测结果:
    │
    ├── MANUAL / AUTO → 正常下载 → 进入总结流程
    │
    └── NONE_AVAILABLE → 
        │
        ├── 单集场景:
        │   ├── 提示用户: "该视频无可用字幕"
        │   ├── 选项1: 使用视频简介/标题生成粗略总结（质量降低）
        │   └── 选项2: 用户自行提供字幕文件上传
        │
        └── 合集场景（多集中部分无字幕）:
            ├── 默认行为: 跳过无字幕的集，只总结有字幕的集
            ├── 在进度中标注: "第 3、7、15 集无字幕，已跳过"
            └── 最终框架图中注明: "以下集数因无字幕未纳入总结"
```

**未来 Whisper 兜底（P4）**：当字幕状态为 `NONE_AVAILABLE` 时，可选下载音频 → 本地 Whisper 语音识别 → 生成字幕文本。此项为后期可选功能，初期不做。

#### 5.3.5 适配器要点

| 适配器 | 匹配规则 | 获取方式 |
|--------|---------|---------|
| BilibiliAdapter | `bilibili.com/video/BV*`, `b23.tv` | B站 API + yt-dlp 降级 |
| YouTubeAdapter | `youtube.com/watch`, `youtu.be` | yt-dlp |
| GenericAdapter | 兜底 | yt-dlp 通用提取 |

字幕获取降级策略（完整流程）：
```
1. 检测可用性 (check_subtitle_availability)
       │
       ▼
2. 按优先级下载:
   优先: 平台官方 API 字幕（人工字幕）→ 最快最准
   次选: yt-dlp 社区字幕            → 通用方案
   备选: yt-dlp 自动字幕（AI字幕）   → 可能有少量错误，但能用
   跳过: 无字幕                     → 告知用户
   未来: Whisper 语音识别           → P4 阶段
```

### 5.4 `agent_framework/` — LangGraph Agent 层（仅 LLM 工作流编排）

> 图内仅包含 LLM 相关的 4 个节点：提取 → 审核 ⇄ 修正 → 框架构建。其他操作（视频解析、字幕下载、Mermaid 生成）在图外 `platform/` 层完成。

#### 5.4.1 State 定义 (`state.py`)

> 图中 State 仅包含 LLM 工作流相关字段。视频元信息和字幕文本由图外前置步骤准备好后直接注入，不再经过图节点处理。

```python
from typing import TypedDict, Annotated
from langgraph.graph.message import add_messages

class SummaryState(TypedDict):
    # === 外部注入（图外前置步骤准备好） ===
    platform: str                  # bilibili / youtube / other
    course_title: str              # 视频/课程标题
    episode_title: str             # 当前处理的单集标题
    subtitle_text: str             # 字幕全文（已按需切分，token 数已验证；无字幕时为空）
    subtitle_status: str           # manual / auto / none → 影响审核策略（auto需更严格）
    episode_index: int | None      # 单集索引
    total_episodes: int            # 合集总集数（单集=1）

    # === LLM 处理中间结果 ===
    chunks: list[dict] | None      # 超长字幕切分后的 chunks（None=未切分）
    extracts: list[dict]           # 多视角提取结果（或 Map 阶段各 chunk 的结果）
    merged_knowledge: dict         # 合并/Reduce 后的知识点
    review_feedback: dict          # 审核Agent的反馈
    review_score: float            # 审核评分 (0.0~1.0)
    retry_count: int              # 当前重试次数

    # === 最终输出 ===
    knowledge_framework: dict      # 完整知识框架（章节→主题→知识点）

    # === 对话历史（追问模式 Phase 4） ===
    messages: Annotated[list, add_messages]
```

#### 5.4.2 主控图 (`graph.py`)

图中仅编排 LLM 工作流（4 节点 + 1 条件边）。视频解析、字幕下载由图外的 `platform/` 层完成，Mermaid 生成为图外后置的纯模板操作。

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver

def build_summary_graph() -> StateGraph:
    graph = StateGraph(SummaryState)

    # 仅添加 LLM 相关节点（4 个）
    graph.add_node("extract_knowledge", extract_knowledge_node)   # 提取（含超长切分调度）
    graph.add_node("review_quality", review_quality_node)         # 审核
    graph.add_node("revise_knowledge", revise_knowledge_node)     # 修正
    graph.add_node("build_framework", build_framework_node)       # 框架构建
    # Phase 4 可选
    # graph.add_node("conversation", conversation_node)

    # 入口：直接进入提取（字幕文本已在 State 中）
    graph.set_entry_point("extract_knowledge")
    graph.add_edge("extract_knowledge", "review_quality")

    # 审核循环：不通过 → 修正 → 再审（最多3次）
    graph.add_conditional_edges(
        "review_quality",
        should_approve_or_retry,
        {
            "approved": "build_framework",
            "revise": "revise_knowledge",
            "max_retries": "build_framework",  # 超过重试次数也继续，标记质量警告
        }
    )
    graph.add_edge("revise_knowledge", "review_quality")

    # 框架构建后结束 — Mermaid 生成在图外完成
    graph.add_edge("build_framework", END)

    # 编译（带状态持久化）
    checkpointer = SqliteSaver.from_conn_string(settings.CHECKPOINT_DB_URL)
    return graph.compile(checkpointer=checkpointer)
```

**对比旧设计的简化**：

| 已移除的节点 | 去向 |
|-------------|------|
| `resolve_video` | → `platform/services/video_resolver.py`（图外前置） |
| `download_subtitles` | → `platform/services/subtitle_fetcher/`（图外前置） |
| `generate_mermaid` | → `platform/core/mermaid_generator.py`（图外后置，纯模板） |

#### 5.4.3 Agent 节点设计

**extract_knowledge_node（知识点提取）**：
```
输入: subtitle_texts（字幕列表）
处理: 3个提取Agent并行运行（不同视角）
  ├── Agent 1: 侧重概念定义和理论
  ├── Agent 2: 侧重实践应用和代码示例
  └── Agent 3: 侧重知识点之间的关联
输出: 合并后的 extracts[] + merged_knowledge
```

**review_quality_node（质量审核）**：
```
输入: merged_knowledge
处理: 审核Agent批判性审查
  ├── 知识点是否完整？有无遗漏？
  ├── 解释是否准确？有无错误？
  ├── 难度标注是否合理？
  ├── 前置依赖是否正确？
  └── 核心/进阶分类是否恰当？
输出: review_feedback + review_score (0.0~1.0)
```

**revise_knowledge_node（修正）**：
```
输入: merged_knowledge + review_feedback
处理: 根据审核意见修改知识点
  └── 补充遗漏、修正错误、调整分类
输出: 修正后的 merged_knowledge
```

**build_framework_node（框架构建）**：
```
输入: merged_knowledge（审核通过后）
处理:
  ├── 去重合并相似知识点
  ├── 按学习路径分章节
  ├── 层级化组织（章节→主题→知识点）
  ├── 标注前置依赖关系
  └── 区分核心必学 vs 进阶选修
输出: knowledge_framework
```

#### 5.4.4 Prompts 设计要点

提取 Agent 的 Prompt 需要加角色视角前缀：
```
视角1: "你是一个注重理论体系的教师。请从以下字幕提取概念性知识点..."
视角2: "你是一个注重实践应用的工程师。请从以下字幕提取操作/代码相关知识点..."
视角3: "你是一个课程设计师。请从以下字幕提取知识点并标注它们之间的依赖关系..."
```

审核 Agent 的 Prompt：
```
你是一个严格的审核员。请审查以下知识点提取结果，找出问题：
1. 遗漏检查：字幕中还讲了哪些知识点但未在结果中出现？
2. 准确性检查：哪个知识点的解释与字幕原文不符？
3. 分类检查：难度标注和核心/进阶分类是否合理？
4. 依赖检查：前置知识依赖关系是否正确？

输出格式：
{
  "score": 0.0-1.0,
  "issues": [{"type": "missing|inaccurate|misclassified|wrong_dep", "detail": "..."}],
  "approved": true/false
}
```
	
#### 5.4.5 字幕超长处理策略

> **触发条件**：先计算字幕 token 数，超过阈值（建议 8000 token，约 DeepSeek 上下文的 6%）才触发切分。

**整体流程**：

```
字幕文本
    │
    ├── token ≤ 阈值（大多数场景）→ 直接送入提取 Agent，不做切分
    │
    └── token > 阈值 → 启动 Map-Reduce 流程：
         │
         ├── 阶段1: 语义切分 (platform/core/text_splitter.py)
         │   按 SRT 时间戳 → 段落 → 句子边界切分
         │   每个 chunk ~3500 token，overlap ~300 token
         │
         ├── 阶段2: 逐块提取 (Map)
         │   Chunk 1 → 提取Agent → 知识点 + 摘要
         │   Chunk 2 → 提取Agent → 知识点 + 摘要（注入 Chunk 1 摘要作为上下文）
         │   Chunk N → ...
         │
         ├── 阶段3: 合并去重 (Reduce)
         │   合并Agent:
         │   ├── 按名称 + 向量相似度去重
         │   ├── 识别跨 chunk 的同一知识点 → 合并
         │   ├── 发现切分点处被截断的知识点 → 补全
         │   └── 输出 unified 知识点列表
         │
         └── 阶段4: 全局审核（复用 review_quality 节点）
             审核Agent 专项检查:
             ├── "有没有知识点在 chunk 边界处被截断？"
             └── "是否有知识点因为分在两个 chunk 中被重复提取？"
```

**切分策略（三层优先级）**：

```python
# platform/core/text_splitter.py — 框架无关的纯函数
class SubtitleTextSplitter:
    """
    切分策略（按优先级降级）：
    1. SRT/VTT 时间戳边界 — 字幕天然以 2-5 秒为粒度，合并相邻段落
    2. 段落/空行边界    — 文本中有明确分段
    3. 句子边界          — 最后的兜底方案
    """

    def __init__(self, chunk_tokens: int = 3500, overlap_tokens: int = 300):
        self.chunk_tokens = chunk_tokens
        self.overlap_tokens = overlap_tokens

    def split(self, subtitle_text: str) -> list[dict]:
        """
        Returns:
            [{"index": 0, "text": "...", "token_count": 3400, "time_range": "00:00-05:30"}, ...]
        """
        # 1. 解析 SRT 格式，提取时间戳 + 文本段落
        segments = self._parse_srt_segments(subtitle_text)

        # 2. 合并短段落直到接近 chunk_tokens
        chunks = self._merge_segments(segments)

        # 3. 在 chunk 边界处添加 overlap（向前取 overlap_tokens 的文本追加到下一个 chunk 开头）
        chunks = self._add_overlap(chunks)

        return chunks
```

**保证切分点连贯性的三个手段**：

| 手段 | 机制 | 解决的问题 |
|------|------|-----------|
| **重叠窗口** | 每个 chunk 向前 overlap 200-300 token | 切分点附近的知识点至少被两个 chunk 覆盖，去重时识别 |
| **前置摘要注入** | 处理 Chunk N 时，把 Chunk N-1 的摘要作为上下文注入 Prompt | Agent 知道"前面讲了什么"，避免重复提取或断裂 |
| **全局审核兜底** | Map-Reduce 结束后，审核 Agent 专项检查切分相关问题 | 合并 Agent 漏掉的跨 chunk 问题在这里被检出 |

**前置摘要注入 Prompt 示例**：

```
前面已经讲过的知识点（供参考，不需要重复提取，但可用于理解上下文）：
- 整型变量 int：用于存储整数的数据类型，占用4字节
- 浮点型 float：用于存储小数，占用4字节
- ...

现在请从以下新内容中提取知识点：
{current_chunk_text}
```

**Token 预算参考**：

| 场景 | 典型字幕长度 | 是否需要切分 |
|------|------------|:----------:|
| 10 分钟短视频 | ~2000-3000 token | ❌ |
| 30 分钟教程 | ~6000-9000 token | ⚠️ 边界，视模型上下文而定 |
| 1 小时以上长视频 | ~15000-30000 token | ✅ 必须切分 |
| 200 集合集 | 总量 100万+ token | ✅ Map-Reduce（按集为 chunk 单位） |

### 5.5 `platform/services/video_resolver.py` — 视频解析服务

**关键设计**：系统只做平台识别和信息提取，**单集/合集的判断交给用户**：

```python
class VideoResolver:
    async def resolve(self, url: str) -> ResolvedVideo:
        """
        1. 工厂方法匹配适配器
        2. 获取视频/合集元信息
        3. 返回完整数据，让前端展示给用户
        4. 用户在前端选择：单集总结 or 全合集总结 or 某集总结
        """
```

返回给前端的结构：
```json
{
  "source_id": 1,
  "platform": "bilibili",
  "source_type": "playlist",
  "title": "黑马程序员C++教程",
  "total_episodes": 200,
  "thumbnail": "https://...",
  "episodes": [
    {"episode_index": 1, "title": "01-C++概述", "url": "https://...?p=1"},
    {"episode_index": 2, "title": "02-变量与数据类型", "url": "https://...?p=2"}
  ]
}
```

前端接收到后：
- `source_type = "single"` → 直接提示"开始总结"
- `source_type = "playlist"` → 弹出 VideoSelector，让用户选择"某一集"或"全合集"

### 5.6 `platform/services/task_manager.py` — 任务管理

任务状态机（Agent 化后增加了 extract/review 阶段）：

```
PENDING → FETCHING → EXTRACTING → REVIEWING → BUILDING → COMPLETED
   │         │           │            │           │
   └─────────┴───────────┴────────────┴───────────┴──→ FAILED
```

### 5.7 API 路由设计

#### `/api/video/resolve`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/video/resolve` | 解析 URL，返回视频信息（不做意图判断） |
| Request | `{"url": "https://www.bilibili.com/video/BV1xx"}` | |
| Response | `{source_id, platform, source_type, title, total_episodes, episodes}` | |

#### `/api/task/summarize`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/task/summarize` | 创建总结任务 |
| Request | `{"source_id": 1, "mode": "full", "episode_index": null}` | mode: single_episode / full_playlist，single_episode 时必传 episode_index |
| Response | `{"task_id": "uuid"}` | |

#### 任务状态查询 & WebSocket

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/task/{task_id}` | 查询任务状态 |
| WS | `/ws/task/{task_id}` | WebSocket 实时推送进度 |

#### 总结结果

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/summary/{summary_id}` | 获取完整总结（框架+知识点） |
| GET | `/api/summary/{summary_id}/mermaid?type=overview` | 获取 Mermaid 图代码 |

#### 导出

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/export/{summary_id}/markdown` | 导出 Markdown |
| GET | `/api/export/{summary_id}/pdf` | 导出 PDF |

#### 历史记录

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/history?page=1&page_size=20` | 历史列表 |
| DELETE | `/api/history/{source_id}` | 删除某条历史 |

---

## 六、前端设计

### 6.1 路由

```
/                               → HomePage           URL 输入 + 选择
/task/:taskId                   → TaskPage            实时进度
/summary/:summaryId             → SummaryPage         结果（框架图Tab）
/summary/:summaryId?tab=detail  → SummaryPage         结果（知识树Tab）
/history                        → HistoryPage         历史记录
```

### 6.2 页面组件树

```
HomePage
└── URLInput                      输入 URL，提交后自动识别平台
    └── VideoSelector             【仅合集时展示】
        ├── 分P列表（可搜索/过滤）
        ├── "总结这一集" 按钮
        └── "总结全合集" 按钮 + 预计耗时提示

TaskPage
└── ProgressTracker
    ├── 进度条 + 百分比动画
    ├── 当前步骤描述（获取字幕→提取知识点→审核→构建框架→生成图表）
    └── 失败时的错误信息 + 重试按钮

SummaryPage
├── Tab: 概括框架 (SummaryOverview)
│   └── KnowledgeGraph            Mermaid mindmap（3层，可缩放拖拽）
│       └── ExportMenu
├── Tab: 详细知识 (SummaryDetail)
│   └── KnowledgeTree             可展开/折叠的递归树
│       └── KnowledgeCard         点击展开详情
└── ExportMenu                    导出 MD / PDF

HistoryPage
└── HistoryList
    └── HistoryCard（标题、平台、时间、知识点数、查看/删除按钮）
```

### 6.3 用户选择单集/合集的交互流程

```
用户粘贴 URL → 点击"解析"
    │
    ▼
后端返回: { source_type: "playlist", episodes: [...] }
    │
    ▼
前端展示 VideoSelector:
    ┌─────────────────────────────┐
    │  📺 黑马程序员C++教程        │
    │  📋 共 200 集               │
    │                             │
    │  🔍 [搜索分P...]            │
    │                             │
    │  ☐ P1: C++概述              │
    │  ☐ P2: 变量与数据类型        │
    │  ☐ P3: 运算符与表达式        │
    │  ...                        │
    │                             │
    │  [总结选中的这一集]           │
    │  [总结全部 200 集] (预计5分钟)│
    └─────────────────────────────┘

（只有 source_type = "single" 时，直接显示 "开始总结" 按钮）
```

---

## 七、Python 依赖

```
# Web 框架
fastapi>=0.115.0
uvicorn[standard]>=0.34.0
python-multipart>=0.0.19

# LLM（OpenAI SDK 兼容 DeepSeek）
openai>=1.58.0

# Agent 框架
langgraph>=0.2.0
langgraph-checkpoint-sqlite>=2.0.0

# 字幕下载
yt-dlp>=2024.12.0

# 数据库
sqlalchemy>=2.0.36
aiosqlite>=0.20.0

# 数据验证
pydantic>=2.10.0
pydantic-settings>=2.7.0

# HTTP
httpx>=0.28.0

# 文件
aiofiles>=24.1.0

# WebSocket
websockets>=14.1

# 导出 PDF
weasyprint>=63.0
markdown>=3.7
```

### Node.js

```
react, react-dom, react-router-dom
vite, @vitejs/plugin-react
tailwindcss, postcss, autoprefixer
mermaid         # 框架图渲染
axios           # HTTP 请求
lucide-react    # 图标
zustand         # 状态管理（可选）
```

---

## 八、关键设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 单集/合集判断 | **用户决定** | 用户最清楚自己的需求，LLM 判断可能不准 |
| 平台识别 | 系统自动 | 纯 URL 正则匹配，不涉及语义理解，不需要 LLM |
| **字幕文件组织** | **一集一文件，一合集一文件夹** | 支持并行处理、单集重试、按集清理，与 Map-Reduce 天然对齐 |
| **字幕可用性检测** | **下载前探测（API + yt-dlp --list-subs）** | 避免无效下载；提前告知用户跳过无字幕的集 |
| **LangGraph 图范围** | **仅 LLM 工作流（4 节点）** | 非 LLM 操作放图外：图做"指挥"不做"干活"，减少状态膨胀和事件循环阻塞 |
| **架构分层** | **platform/ + agent_framework/** | `platform/` 不引入 LangGraph 依赖，可独立单元测试；Agent 层专注编排 |
| 提取+审核 | 多 Agent 协作 | 多视角提取+批判审核，质量显著高于单次调用 |
| 审核循环上限 | 3 次 | 避免无限循环浪费 token |
| **字幕超长处理** | **语义切分 + 重叠窗口 + 前置摘要注入** | 三层保障（重叠覆盖、上下文注入、全局审核）确保切分点知识点连贯性 |
| 状态持久化 | LangGraph Checkpointer | 原生支持断点续传，比自建更可靠，仅作用于 LLM 工作流 |
| 合集处理 | Map-Reduce + 分组 | 避免单次对话放不下所有知识点，按集为自然 chunk 单位 |
| Mermaid 生成 | **纯模板引擎（图外）** | data→text 确定性转换，不需要 LLM 也不需要在图中 |
| 前端状态管理 | zustand 或 Context | 状态简单，不需要 Redux |

---

## 九、技术栈对比：Pipeline vs Agent vs 混合架构

| 维度 | Pipeline（无框架） | Agent 系统（LangGraph） | **本项目：混合架构** |
|------|-------------------|------------------------|---------------------|
| 流程编排 | 代码硬编码 if/else | 状态图 + LLM 决策路由 | **图外前置/后置 + 图内编排** |
| 质量保障 | 单次 LLM 调用 | 多 Agent 协作 + 审核修正循环 | ✅ 多 Agent + 审核循环（同 Agent 系统） |
| 非 LLM 操作 | 代码直接调用 | 可能混入图中 | **放在 platform/ 层，图外执行** |
| 容错能力 | try/except 固定降级 | Agent 自主判断并选择降级方案 | ✅ 图内 Agent 降级 + 图外 retry |
| 用户交互 | 单向展示 | 支持对话追问 | ✅ 支持对话追问（Phase 4） |
| 状态管理 | 自建 task 表 | LangGraph Checkpointer | **task 表（全流程）+ Checkpointer（LLM 段）** |
| 扩展新功能 | 加代码 | 加 Agent 节点 / Tool | 加 platform 服务 / 加 Agent 节点 |
| 可测试性 | 高（纯函数） | 中（依赖图状态） | **platform/ 层高（纯函数），Agent 层中** |
| 复杂度 | 低 | 中 | 中 |
| 适用场景 | 流程固定，不需要动态决策 | 需要质量保障、灵活路由、多轮交互 | **本项目：确定性操作多 + LLM 核心链路需要质量保障** |

---

## 十、开发路线图（按优先级排序）

### 🔴 P0 — 必须最先实现（核心闭环）

没有这些，系统跑不起来。

| # | 模块 | 文件 | 说明 |
|---|------|------|------|
| 1 | 配置 | `backend/app/config.py` | Settings 类，.env 加载 |
| 2 | 数据库 | `backend/app/models/database.py` | engine + session |
| 3 | 数据库 | `backend/app/models/schema.py` | 4 张表的 ORM Model |
| 4 | 字幕基类 | `backend/app/platform/services/subtitle_fetcher/base.py` | 抽象基类 |
| 5 | 字幕通用 | `backend/app/platform/services/subtitle_fetcher/generic.py` | yt-dlp 通用适配器 |
| 6 | 字幕工厂 | `backend/app/platform/services/subtitle_fetcher/factory.py` | URL → 适配器映射 |
| 7 | 视频解析 | `backend/app/platform/services/video_resolver.py` | URL 解析、平台识别、信息提取 |
| 8 | LLM 客户端 | `backend/app/agent_framework/tools/` 之前先做基础：直接封一个 `llm_client.py` | DeepSeek 调用封装 |
| 9 | 提取 Prompt | `backend/app/agent_framework/prompts/extract_prompts.py` | 知识点提取 Prompt |
| 10 | 单集总结 | 先做简单版：`backend/app/platform/services/summarizer.py` | 直接调 LLM，不用 Agent |
| 11 | API-视频 | `backend/app/api/video.py` | `/api/video/resolve` |
| 12 | API-任务 | `backend/app/api/task.py` | `/api/task/summarize` + `/api/task/{id}`（同步版） |
| 13 | 应用入口 | `backend/app/main.py` | FastAPI app 组装 |
| 14 | 前端 | `frontend/` 全套 | Vite + React + Tailwind，HomePage + TaskPage + SummaryPage |
| 🔴 | **验证点** | **输入 B站 URL → 选单集 → 看到总结** | |

### 🟡 P1 — 核心功能完善（Agent 化 + 合集）

| # | 模块 | 文件 | 说明 |
|---|------|------|------|
| 15 | B站适配器 | `subtitle_fetcher/bilibili.py` | B站 API 适配器 |
| 16 | YouTube适配器 | `subtitle_fetcher/youtube.py` | YouTube 适配器 |
| 17 | Agent State | `agent_framework/state.py` | LangGraph State 定义 |
| 18 | 提取 Agent | `agent_framework/agents/extract_agent.py` | 多视角提取 |
| 19 | 审核 Agent | `agent_framework/agents/review_agent.py` | 质量审核 |
| 20 | 修正 Agent | `agent_framework/agents/revise_agent.py` | 根据审核意见修正 |
| 21 | 审核 Prompt | `agent_framework/prompts/review_prompts.py` | 审核 Prompt |
| 22 | 框架 Agent | `agent_framework/agents/framework_agent.py` | 知识框架构建 + 去重 |
| 23 | 框架 Prompt | `agent_framework/prompts/framework_prompts.py` | 框架构建 Prompt |
| 24 | 主控图 | `agent_framework/graph.py` | 状态图构建 |
| 25 | 主控器 | `agent_framework/supervisor.py` | Supervisor 封装 |
| 26 | 持久化 | `agent_framework/checkpointer.py` | LangGraph Checkpointer |
| 27 | 工具封装 | `agent_framework/tools/` | 各 Tool 封装 |
| 28 | 任务管理 | `platform/services/task_manager.py` | 完整异步任务 + 进度 |
| 29 | WS 进度 | `api/task.py` 补充 | WebSocket 实时推送 |
| 30 | 前端合集 | `VideoSelector.jsx` | 合集选择器组件 |
| 31 | 前端进度 | `ProgressTracker.jsx` | WebSocket 实时进度 |
| 🔴 | **验证点** | **输入合集 URL → 全集合总结 → 审核修正 → 框架图** | |

### 🟢 P2 — 体验完善

| # | 模块 | 文件 | 说明 |
|---|------|------|------|
| 32 | Mermaid 工具 | `platform/core/mermaid_generator.py` | 框架图代码生成（纯模板） |
| 33 | 文本切分 | `platform/core/text_splitter.py` | 长字幕语义分段处理 |
| 34 | 结果 API | `api/summary.py` | 总结结果查看 |
| 35 | 历史 API | `api/history.py` | 历史记录 CRUD |
| 36 | 导出 API | `api/summary.py` 补充 | Markdown/PDF 导出 |
| 37 | 前端知识树 | `KnowledgeTree.jsx` + `KnowledgeCard.jsx` | 详细知识树 |
| 38 | 前端历史 | `HistoryPage.jsx` + `HistoryList.jsx` | 历史管理 |
| 39 | 前端导出 | `ExportMenu.jsx` | 导出按钮 |
| 40 | 前端状态 | `zustand` store | 全局状态管理 |
| 🔴 | **验证点** | **全功能使用 + 历史回顾 + 导出** | |

### 🔵 P3 — 部署与增强

| # | 模块 | 文件 | 说明 |
|---|------|------|------|
| 41 | Docker | `Dockerfile` ×2 + `docker-compose.yml` | 容器化 |
| 42 | 错误处理 | 全局 | 异常处理、日志完善 |
| 43 | 性能优化 | 全局 | 缓存、并发调优 |
| 🔴 | **验证点** | **docker-compose up → 全功能可用** | |

### ⚪ P4 — 后续优化（未来可做）

| # | 模块 | 说明 |
|---|------|------|
| 44 | 对话追问 | 总结完成后对话式深入探索知识点 |
| 45 | 搜索补充 | Agent 自主搜索网络补充知识点背景 |
| 46 | Whisper 兜底 | 无字幕视频的语音识别 |
| 47 | 跨会话记忆 | 多个总结之间交叉引用，构建个人知识图谱 |
| 48 | 更多平台 | 腾讯课堂、网易云课堂、慕课网等 |
| 49 | 知识卡片分享 | 生成精美的知识点卡片图片，可分享 |
| 50 | 定时追踪 | 追更功能：合集更新后自动总结新增集数 |

---

## 十一、总结结果 JSON 结构速查

```json
{
  "summary_id": 1,
  "source_id": 1,
  "source_title": "黑马程序员C++教程",
  "summary_type": "full",
  "total_episodes": 200,
  "summarized_episodes": 200,

  "overview": {
    "description": "本课程从零基础开始，系统讲解C++编程语言...",
    "total_knowledge_points": 156,
    "difficulty_distribution": {"beginner": 60, "intermediate": 70, "advanced": 26}
  },

  "chapters": [
    {
      "title": "第1章：C++基础入门",
      "order": 1,
      "description": "介绍C++开发环境和基本语法",
      "topics": [
        {
          "name": "变量与数据类型",
          "knowledge_points": [
            {
              "id": "kp_001",
              "name": "整型变量 int",
              "explanation": "用于存储整数的数据类型，占用4字节",
              "difficulty": "beginner",
              "key_concept": true,
              "prerequisites": [],
              "examples": ["int a = 10;", "int b = a + 5;"],
              "from_episode": 2
            }
          ]
        }
      ]
    }
  ],

  "mermaid_overview": "mindmap\n  root((C++完整教程))\n    第1章 C++基础入门\n      变量与数据类型\n      ...\n    第2章 流程控制\n      ...",

  "mermaid_detailed": "mindmap\n  root((C++完整教程))\n    ...(4-5层完整)...",

  "dependencies": [
    {"from": "kp_001", "to": "kp_010", "relation": "prerequisite"}
  ]
}
```
