# vksummary 视频内容知识总结 — 设计文档（以实际开发为准）

> 本文档根据当前实际代码整理。若与旧版设计或 README 存在出入，以当前实际代码为准。

## 一、项目概述

**核心目标**：输入 B 站视频链接，自动拉取字幕，调用 LLM 把字幕提炼成结构化知识框架，并在前端以思维导图形式展示，让用户不用看视频也能快速掌握知识点。

**当前能力**：

- 支持 B 站单视频 / 合集（多 P）
- 自动识别 BV 号与当前分 P
- 后台异步下载字幕，支持并发拉取、无字幕分 P 跳过
- LangGraph 三节点 Agent 链路：`extract → review ⇄ revise`
- 审核通过（score ≥ 0.8）或最多修订 3 轮后结束
- 前端自绘 SVG 思维导图，支持缩放、拖拽、节点讲解、合集分集切换、大纲导航
- SSE 实时推送任务进度
- 文件系统存储字幕与总结结果，无数据库
- 页面内配置 LLM 参数与 B 站 Cookie，并支持连通性测试

**技术栈（实际）**：

| 层 | 技术 |
|---|---|
| 后端 | Python + FastAPI + Uvicorn（端口 `5000`） |
| Agent 编排 | LangGraph（`extract → review ⇄ revise` 条件循环） |
| LLM | `langchain` / `langchain_openai`（兼容 OpenAI API 格式） |
| 视频/字幕 | `bilibili-api-python` |
| 前端 | React 18 + Vite（端口 `3000`）+ Tailwind CSS |
| 实时通信 | SSE（Server-Sent Events） |
| 存储 | 文件系统（`backend/data/`） |
| JSON 容错 | `json5` + 自研多级 `json_repair` |

## 二、整体架构

### 2.1 总体流程

```
用户输入 B 站 URL
        │
        ▼
POST /api/video/get_video_info
        │  返回 bvid / video_type / current_page / pages
        ▼
前端展示分 P 列表，用户选择单集或任意多集
        │
        ▼
POST /api/video/start_video_subtitles
        │  立即返回 bvid_uid，后台异步执行
        ▼
后台任务：_download_all_subtitles
        │  并发拉取字幕（Semaphore=3）
        │  保存到 backend/data/subtitles/{bvid_uid}.md
        ▼
后台任务：supervisor.parse_subtitles
        │  读取字幕文件
        │  调用 LangGraph：extract → review ⇄ revise
        ▼
写入 backend/data/summary_subtitles/{bvid_uid}.json
        │
        ▼
前端通过 SSE 收到 phase=done 后自动加载思维导图
```

### 2.2 任务与进度模型

- `bvid_uid` 格式：`{bvid}_{uuid4}`，作为一次任务的唯一标识。
- 进度消息通过内存中的 `asyncio.Queue` 按 `bvid_uid` 隔离。
- 后端后台任务主动 `publish` 消息；前端通过 SSE `subscribe` 消费。
- 前端可能晚于后台任务连接 SSE，因此会丢失部分早期消息，但不影响最终结果展示。
- 任务结束（成功或失败）都会推送 `phase="done"`，保证 SSE 能正常关闭。

## 三、项目目录结构（实际）

```
vksummary/
├── backend/
│   ├── .env / .env.example          # sessdata / bili_jct / buvid3 / model / base_url / api_key
│   ├── requirements.txt
│   └── app/
│       ├── main.py                  # FastAPI 入口、CORS、日志配置
│       ├── config.py                # .env 读取与写入
│       ├── api/
│       │   ├── video.py             # 视频信息解析、启动字幕下载
│       │   ├── task.py              # SSE、任务结果、任务列表、删除任务
│       │   └── settings.py          # 环境变量保存 / 获取 / 测试
│       ├── models/
│       │   └── models.py            # Pydantic 请求模型
│       ├── services/
│       │   └── video_resolver.py    # B 站信息获取、字幕下载、后台任务调度
│       ├── agent_framework/
│       │   ├── state.py             # LangGraph State 定义
│       │   ├── graph.py             # 三节点状态图
│       │   ├── supervisor.py        # 读取字幕 → 跑图 → 写结果
│       │   ├── agents/
│       │   │   ├── extract.py       # 提取 Agent
│       │   │   ├── review.py        # 审核 Agent
│       │   │   └── revise.py        # 修订 Agent
│       │   └── prompts/
│       │       ├── extract_prompts.py
│       │       ├── review_prompts.py
│       │       └── revise_prompts.py
│       └── utils/
│           ├── queue_utils.py       # 全局 asyncio.Queue 字典
│           └── json_repair.py       # LLM 输出 JSON 多级修复
├── frontend/
│   ├── package.json
│   ├── vite.config.js               # 端口 3000，/api 代理到 5000
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                  # 单页应用主状态与布局（无路由）
│       ├── api/client.js            # axios + SSE 封装
│       ├── components/
│       │   ├── TopBar.jsx
│       │   ├── EnvConfigModal.jsx
│       │   ├── TaskSidebar.jsx
│       │   ├── VideoPanel.jsx
│       │   ├── MindMapPanel.jsx
│       │   ├── EpisodeList.jsx
│       │   └── OutlinePanel.jsx
│       └── index.css
└── docs/
    ├── design.md                    # 本文档
    └── curr_progress.md             # 开发进度记录
```

## 四、后端核心模块

### 4.1 `config.py` — 环境变量管理

- 环境变量文件固定为 `backend/.env`。
- 启动时通过 `load_dotenv(ENV_FILE)` 加载。
- `set_env_param(envparam)` 同时写入 `os.environ` 与 `.env` 文件。
- `get_env_param()` 返回以下键：

```
sessdata
bili_jct
buvid3
model
base_url
api_key
```

### 4.2 `models/models.py` — Pydantic 模型

```python
class EnvParam(BaseModel):
    sessdata: str
    bili_jct: str
    buvid3: str
    model: str
    base_url: str
    api_key: str

class VideoUrlParam(BaseModel):
    video_url: str

class VideoPagesParam(BaseModel):
    bvid: str
    pages: list[dict]
```

### 4.3 `services/video_resolver.py` — 视频信息与字幕下载

**获取视频信息**：

- 从 URL 中正则提取 `BV` 号与 `p` 参数。
- 使用 `bilibili_api.video.Video` + `Credential` 调用 `get_info()`。
- 根据 `info["videos"]` 判断：
  - `1` → `video_type = "single"`
  - `> 1` → `video_type = "multi"`
- 返回 `pages` 列表（包含 `cid`、`page`、`part`、`duration`、`first_frame` 等字段）。

**启动字幕下载**：

- `start_subtitle_download(bvid, pages)`：
  - 生成 `bvid_uid = f"{bvid}_{uuid.uuid4()}"`
  - 创建 `asyncio.create_task(_download_all_subtitles(...))`
  - 任务引用保存到全局 `_background_tasks`，防止 GC
  - 立即返回 `bvid_uid`

**字幕下载逻辑**：

- 使用 `asyncio.Semaphore(3)` 控制并发。
- 每个分 P 通过 `v.get_subtitle(cid)` 获取字幕列表。
- 无字幕或字幕 URL 缺失 → 标记跳过，不中断整体任务。
- 有字幕 → 请求 `subtitle_url` 获取 JSON，拼接为纯文本。
- 字幕文件格式：

```
### part: {part}, page: {page}, cid: {cid}
{字幕文本}

...
```

- 全部写入同一个 `backend/data/subtitles/{bvid_uid}.md`。
- 所有分 P 都失败时推送错误并结束；部分成功时提示跳过集数。
- 字幕任务成功后自动启动 `supervisor.parse_subtitles(bvid_uid)`。

### 4.4 `utils/queue_utils.py` — SSE 消息队列

```python
_queues: dict[str, asyncio.Queue] = {}

def publish(bvid_uid, message): ...
async def subscribe(bvid_uid): ...
def cleanQueue(bvid_uid): ...
```

- `publish` 在队列不存在时自动创建，避免消息丢失。
- `subscribe` 从队列阻塞读取一条消息。
- `cleanQueue` 在 SSE 断开时清理对应队列。

### 4.5 `agent_framework/state.py` — LangGraph State

```python
class AgentState(TypedDict):
    bvid_uid: str
    subtitles: str

    loop_count: int
    extract_output: dict
    review_output: dict
    revise_output: dict

    cur_output: dict      # 当前可作为最终输出的结果

    messages: Annotated[List[BaseMessage], add_messages]
```

- `cur_output` 是核心字段：extract 首次写入，revise 逐轮覆盖，循环结束后 supervisor 落盘。

### 4.6 `agent_framework/graph.py` — 状态图

```
START → extract → review
                    │
        ┌───────────┴───────────┐
        │ approved 或 loop>=3   │ 否则 revise
        ▼                       ▼
       END                   revise → review
```

- `extract_agent`：字幕 → 知识框架，写入 `extract_output` 与 `cur_output`。
- `review_agent`：对照字幕审核 `cur_output`，输出 `review_output`（含 `score` / `issues` / `approved`）。
- `decide_after_review`：`approved == True` 或 `loop_count >= 3` 时结束，否则进入 `revise`。
- `revise_agent`：按审核意见修订完整框架，覆盖 `cur_output`，`loop_count += 1`。

### 4.7 `agent_framework/supervisor.py` — 任务主控

1. 发布 `phase="agent"` 启动消息。
2. 读取 `backend/data/subtitles/{bvid_uid}.md`。
3. 调用 `graph.ainvoke({"bvid_uid": ..., "subtitles": ..., "loop_count": 0})`。
4. 取 `result["cur_output"]` 作为最终结果。
5. 写入 `backend/data/summary_subtitles/{bvid_uid}.json`。
6. 在结果中附加 `source_url`，值为 `https://www.bilibili.com/video/{bvid}`。
7. 成功 / 失败均推送 `phase="done"`，失败时删除可能已写入的结果文件。

### 4.8 Agent 实现要点

- 三个 Agent 均使用 `langchain_openai.ChatOpenAI`，参数来自 `config.get_env_param()`。
- 使用 `langchain.agents.create_agent(model=llm, tools=[], system_prompt=...)` 创建。
- 每个 Agent 的 LLM 调用有 2 次重试，失败按 `2 ** attempt` 秒指数退避。
- LLM 返回内容统一经过 `utils/json_repair.py` 的 `repair_and_parse_json()` 解析为 dict。

### 4.9 `utils/json_repair.py` — JSON 兜底修复

解析级别（逐级尝试，成功即返回）：

1. 标准 `json.loads`
2. 剥除 ```json 代码围栏，提取第一个 `{` 到最后一个 `}` 的子串
3. `json5` 宽容解析
4. 无损修复：单引号、Python 风格 `True/False/None/NaN/Infinity`、尾随逗号、字符串内裸换行
5. 破坏性兜底：字符串内未转义双引号替换为中文引号

## 五、API 接口（实际）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/video/get_video_info` | 根据 URL 获取视频信息 |
| POST | `/api/video/start_video_subtitles` | 启动字幕下载 + Agent 后台任务，返回 `bvid_uid` |
| GET | `/api/task/sse/{bvid_uid}` | SSE 实时推送任务进度 |
| GET | `/api/task/task_response/{bvid_uid}` | 获取总结结果 JSON |
| GET | `/api/task/all_task_list` | 获取已完成任务列表 |
| DELETE | `/api/task/finished_task/{bvid_uid}` | 删除已完成任务（同时删除字幕文件和结果文件） |
| POST | `/api/settings/set_env_param` | 保存环境变量到 `.env` |
| GET | `/api/settings/get_env_param` | 获取环境变量 |
| POST | `/api/settings/test_env` | 测试 LLM 与 B 站 Cookie 是否可用 |

### 5.1 `POST /api/video/get_video_info`

请求：

```json
{ "video_url": "https://www.bilibili.com/video/BV1xx?p=2" }
```

响应：

```json
{
  "bvid": "BV1xx",
  "video_type": "single",
  "current_page": 2,
  "pages": [
    {
      "cid": 123,
      "page": 1,
      "part": "视频标题",
      "duration": 600,
      "first_frame": "https://..."
    }
  ]
}
```

> `video_type` 实际取值为 `"single"` 或 `"multi"`。

### 5.2 `POST /api/video/start_video_subtitles`

请求：

```json
{
  "bvid": "BV1xx",
  "pages": [
    { "cid": 123, "page": 1, "part": "..." }
  ]
}
```

响应：

```json
{
  "bvid_uid": "BV1xx_3f0a6f18-...",
  "bvid": "BV1xx"
}
```

### 5.3 SSE 消息格式

```json
{
  "bvid_uid": "BV1xx_...",
  "phase": "subtitles",
  "message": "任务进度描述",
  "done": false,
  "error": null
}
```

- 字幕阶段：`phase="subtitles"`
- Agent 阶段：`phase="agent"`
- 结束：`phase="done"`，成功时 `done=true, error=null`，失败时 `error` 有值

### 5.4 `GET /api/task/task_response/{bvid_uid}`

响应：

```json
{
  "bvid_uid": "BV1xx_...",
  "data": {
    "type": "single",
    "title": "...",
    "root": {},
    "episodes": [],
    "crossLinks": [],
    "source_url": "https://www.bilibili.com/video/BV1xx"
  }
}
```

### 5.5 `GET /api/task/all_task_list`

响应：

```json
{
  "data": [
    {
      "bvid_uid": "BV1xx_...",
      "type": "single",
      "title": "视频标题"
    }
  ]
}
```

### 5.6 `DELETE /api/task/finished_task/{bvid_uid}`

- 删除 `data/summary_subtitles/{bvid_uid}.json`
- 删除 `data/subtitles/{bvid_uid}.md`
- 至少删除一个文件才算成功，否则返回 404

## 六、数据存储与 JSON 结构（实际）

### 6.1 字幕文件

路径：`backend/data/subtitles/{bvid_uid}.md`

```markdown
### part: Nginx是什么？, page: 1, cid: 123
字幕文本内容...

### part: 第二个分P, page: 2, cid: 456
...
```

### 6.2 总结结果 JSON

路径：`backend/data/summary_subtitles/{bvid_uid}.json`

**单视频**：

```json
{
  "type": "single",
  "title": "视频标题",
  "root": {
    "label": "核心主题",
    "description": "整个视频的完整总结",
    "children": [
      {
        "label": "一级概念",
        "description": "详细讲解",
        "children": []
      }
    ]
  },
  "source_url": "https://www.bilibili.com/video/BV1xx"
}
```

**合集/多 P**：

```json
{
  "type": "collection",
  "title": "合集总标题",
  "episodes": [
    {
      "title": "P1: 原标题",
      "root": {
        "label": "本集核心主题",
        "description": "...",
        "children": []
      }
    }
  ],
  "crossLinks": [
    {
      "from": "P1的某个概念label",
      "to": "P2的某个概念label",
      "relation": "前置知识 | 延伸 | 对比 | 互补"
    }
  ],
  "source_url": "https://www.bilibili.com/video/BV1xx"
}
```

## 七、前端设计（实际）

### 7.1 页面形态

当前是单页应用（无 react-router），由 `App.jsx` 管理三种布局：

- `hero`：首页大搜索框 + 视频解析结果
- `normal`：左侧视频面板 + 右侧思维导图占位
- `mindmap`：全屏思维导图 + 可选选集/大纲

### 7.2 组件职责

| 组件 | 职责 |
|---|---|
| `TopBar` | 环境状态指示灯、Logo、AI 对话占位按钮 |
| `EnvConfigModal` | 配置/测试/保存环境变量 |
| `TaskSidebar` | 展示进行中/已完成任务，支持管理删除 |
| `VideoPanel` | URL 解析、分 P 选择、启动任务、展示 SSE 进度 |
| `MindMapPanel` | 自绘 SVG 思维导图，缩放/拖拽/节点详情 |
| `EpisodeList` | 合集思维导图的总览/分集切换 |
| `OutlinePanel` | 右侧节点导航抽屉 |

### 7.3 思维导图

- 非 Mermaid，前端自绘 SVG。
- 按 `label` 估算文本宽度，递归布局树。
- 节点按分支着色，支持点击查看 `description`。
- 支持滚轮缩放、鼠标拖拽平移、重置视图。
- 合集支持“总览”合并展示与“单集”切换展示。

### 7.4 SSE 管理

- `api/client.js` 封装 `EventSource`。
- 收到 `phase="done"` 或 `error` 后自动关闭连接。
- `App.jsx` 统一管理当前 SSE 连接与消息历史，避免组件切换导致连接丢失。
- 页面刷新后，会为仍在处理中的任务自动重连 SSE。

## 八、关键设计决策（实际）

| 决策 | 实际选择 | 说明 |
|---|---|---|
| 单集/合集判断 | 用户决定 | 后端只返回分 P 列表，不替用户判断意图 |
| 存储 | 文件系统 | 字幕 `.md`、结果 `.json`，无数据库 |
| 实时通信 | SSE | 实现简单，单向推送足够 |
| 任务标识 | `bvid_uid` | `{bvid}_{uuid}`，贯穿字幕与结果文件 |
| 字幕并发 | `asyncio.Semaphore(3)` | 控制并发，降低被封风险 |
| 单集失败 | 跳过不中断 | 无字幕/下载失败仅提示，不影响其它分 P |
| Agent 图 | 3 节点 | `extract → review ⇄ revise`，不引入框架构建节点 |
| 审核标准 | score ≥ 0.8 | `approved=true` 才结束；否则最多修订 3 轮 |
| 最终结果 | `cur_output` | extract 写入、revise 覆盖，循环结束直接落盘 |
| JSON 容错 | 多级修复 | json5 + 无损修复 + 中文引号兜底 |
| 前端图渲染 | 自绘 SVG | 不依赖 Mermaid，便于交互定制 |

## 九、与旧设计文档的差异

旧版 `design.md` 中以下内容尚未实现或已简化：

| 旧设计 | 实际状态 |
|---|---|
| SQLite / ORM 数据库 | 未使用，改为文件系统 |
| WebSocket 实时推送 | 未使用，改为 SSE |
| Mermaid 渲染 | 前端已安装 `mermaid` 依赖但未实际使用，当前为自绘 SVG |
| 4 个 Agent 节点（含 framework build） | 当前 3 个节点：extract / review / revise |
| 多视角并行提取 / 合并 Agent | 未实现，当前单 extract Agent |
| yt-dlp 多平台适配器 | 未实现，当前仅 B 站 `bilibili-api-python` |
| 字幕超长切分 Map-Reduce | 未实现，当前整段字幕直接交给 LLM |
| 对话追问 Agent（Phase 4） | 未实现，前端仅有占位按钮 |
| 导出 Markdown / PDF | 未实现 |
| Docker 部署 | 未实现 |
| LangGraph Checkpointer / 断点续传 | 未实现，当前内存执行状态 |

## 十、当前进度与后续规划

### 已实现

- B 站视频解析（单视频/合集）
- 字幕并发下载、无字幕跳过、失败清理文件
- SSE 实时进度
- LangGraph 提取 → 审核 → 修订循环
- 总结结果落盘与历史列表
- 前端思维导图、分集切换、大纲导航、任务管理、环境配置

### 后续可做

- LLM Chat 对话追问
- 多视角提取 / 合并 Agent
- 长字幕自动切分 Map-Reduce
- 更多平台适配（yt-dlp）
- 导出 Markdown / PDF
- Docker 部署
- Whisper 无字幕兜底
- 任务状态持久化 / 断点续传

## 十一、依赖清单（实际）

### 后端 `backend/requirements.txt`

```
bilibili_api_python==17.4.2
fastapi==0.141.1
httpx==0.28.1
json5==0.15.0
langchain==1.3.15
langchain_core==1.5.4
langchain_openai==1.5.0
langgraph==1.2.11
pydantic==2.13.4
python-dotenv==1.2.2
Requests==2.34.2
uvicorn==0.52.3
```

### 前端 `frontend/package.json`

```
axios
lucide-react
mermaid（已安装，当前渲染未使用）
react
react-dom
vite
@vitejs/plugin-react
tailwindcss
postcss
autoprefixer
```
