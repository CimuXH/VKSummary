# vksummary — 视频内容知识总结

输入一个 B 站视频链接，自动拉取字幕，并调用 LLM 把字幕提炼成**结构化知识框架（思维导图）**，让你不用看视频也能快速掌握知识点。同时支持基于**所有已下载字幕**的全局 LLM Chat 问答。

---

## 功能特性

- **B 站视频解析**：粘贴 URL，自动识别 BV 号，区分单视频 / 合集（分 P），展示分集列表。
- **字幕拉取**：基于 `bilibili_api` 拉取 CC 字幕（需 B 站登录 Cookie），分 P 无字幕/失败时自动跳过。
- **AI 知识框架提取**：提炼层级化知识框架，`label` 为节点精炼标题，`description` 为节点详细讲解卡片。
- **单集 / 合集两种结构**：单视频输出一个 `root` 树；合集按分 P 输出 `episodes` 并附跨集关联 `crossLinks`。
- **审查与修订**：`extract → review → revise` 循环，最多修订 3 轮。
- **思维导图**：前端自绘 SVG 树状图（非 Mermaid），支持节点展开讲解、合集分集切换、大纲抽屉导航。
- **实时进度**：SSE 推送字幕下载、Agent 解析等阶段状态。
- **任务历史**：左侧边栏展示进行中/已完成任务，支持查看、删除，进度本地持久化。
- **全局 LLM Chat**：按需调用字幕检索工具，支持流式输出和独立对话页签。
- **混合检索**：Chroma 向量检索 + SQLite FTS5 BM25 关键词检索，通过 RRF 融合结果。
- **本地 Embedding**：使用本地中文模型 `bge-small-zh-v1.5`，不依赖外部 embedding API。
- **环境配置**：页面内配置 LLM 参数与 B 站 Cookie，一键测试连通性，并提供获取 Cookie 教程。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python + FastAPI + Uvicorn（端口 `5000`） |
| Agent 编排 | LangGraph（`extract → review → revise` 条件循环） |
| LLM 调用 | `langchain` / `langchain_openai`（Agent）+ `openai` SDK（Chat 流式） |
| 视频/字幕 | `bilibili-api-python` |
| 文本分块 | `langchain_text_splitters` |
| 前端 | React 18 + Vite（端口 `3000`）+ Tailwind CSS + axios + lucide-react |
| 实时通信 | SSE（Server-Sent Events） |
| 向量检索 | Chroma + 本地 Embedding（`bge-small-zh-v1.5`） |
| 关键词检索 | SQLite FTS5 BM25（中文双字切分 + `unicode61`，完整短语优先） |
| 中文分词 | jieba |
| 存储 | 文件系统 + SQLite（Chat 索引 / 对话历史） |

---

## 目录结构

```
vksummary/
├── backend/
│   ├── app/
│   │   ├── api/                     # video / task / settings / chat
│   │   ├── services/                # video_resolver / chat_service
│   │   ├── agent_framework/         # LangGraph 三节点图 + 三个 agent
│   │   ├── utils/                   # json_repair / queue_utils / retrieve
│   │   ├── embeding_model/          # 本地 embedding 模型 bge-small-zh-v1.5
│   │   └── main.py                  # FastAPI 入口
│   ├── requirements.txt
│   ├── .env.example
│   └── data/                        # 运行时生成：subtitles/ summary_subtitles/ chat_index/
├── frontend/
│   ├── public/
│   │   ├── how_to_setenv.html       # 获取环境变量教程页
│   │   └── how_to_setenv.png
│   └── src/
│       ├── api/                     # client.js / chatClient.js
│       ├── components/              # 各面板组件 + ChatPanel
│       ├── chat/                    # chatFeature（激活右上角 Chat 按钮）
│       └── main.jsx
└── README.md
```

---

## 环境要求

- Python 3.10+（推荐 3.11 / 3.12）
- Node.js 18+
- 一个**兼容 OpenAI API 格式**的 LLM 服务（提供 `model` / `base_url` / `api_key`）。Chat 模型需支持流式工具调用。
- 可用的 **B 站登录 Cookie**（`sessdata` / `bili_jct` / `buvid3`），用于拉取字幕
- 本地 embedding 模型已放在 `backend/app/embeding_model/BAAI--bge-small-zh-v1.5`

---

## 本地部署启动

**1. 安装后端依赖**：

```bash
cd backend
pip install -r requirements.txt
```

**2. 配置环境变量**：

```bash
cd backend
cp .env.example .env   # （创建完成.env之后可不着急填写，项目启动后再页面中也可填写）编辑 .env 填入 sessdata/bili_jct/buvid3 与 model/base_url/api_key
```

也可启动后在页面「环境配置」弹窗里填写保存（写入同一 `.env`），并支持测试连通性。

**3. 启动后端**：

```bash
cd backend/app
python main.py          # 运行于 http://localhost:5000
```

**4. 启动前端**：

```bash
cd frontend
npm install
npm run dev             # 运行于 http://localhost:3000，/api 已代理到 5000
```

浏览器打开 `http://localhost:3000` 使用。

---

## 使用说明

1. 确认右上角环境状态为绿色（LLM + Cookie 可用），否则进入「环境配置」填写并测试。
2. 粘贴 B 站视频链接解析；合集可选全部或指定某一集。
3. 开始后页面实时展示「字幕下载 → Agent 解析」进度，完成后自动展示思维导图。
4. 点击节点展开讲解；合集可切换分集、查看跨集关联；大纲抽屉可快速定位节点。
5. 左侧任务历史可回看、删除任务；刷新后仍在处理的任务会自动恢复进度连接。
6. 点击右上角 Chat 按钮，可基于**所有已下载字幕**进行全局问答，回答会流式展示。

---

## 工作原理

### Agent 知识框架提取

核心是一个三节点条件循环图：

```
extract ──► review ──(通过或达3轮上限)──► 结束
                │
                └──(未通过)──► revise ──► review
```

- **extract**：字幕 → 知识框架，写入 `cur_output`；
- **review**：打分、列问题、判断 `approved`；
- **revise**：按审查意见修订并**覆盖更新 `cur_output`**，`loop_count + 1`。

`cur_output` 即「当前可作为最终输出的结果」：extract 初始写入、revise 逐轮覆盖，循环结束后由 supervisor 落盘为 `backend/data/summary_subtitles/{bvid_uid}.json`。LLM 输出的 JSON 由 `utils/json_repair.py` 多级兜底修复，并对调用做 2 次指数退避重试。

### LLM Chat 问答

```
用户提问
   ↓
模型收到近期对话和 search_tools 入口
   ├─ 普通问题 → 直接流式回答
   └─ 需要字幕 → search_tools → 加载 search_subtitles 参数定义
                    ↓
              调用字幕混合检索（Chroma + BM25 + RRF）
                    ↓
              根据片段和来源流式回答
```

在 Chat 面板点「新建对话」即可切换话题。每个页签独立保存消息，可以在某个页签生成时切到另一个页签。升级后，原有历史会归到「默认对话」。模型读取当前会话的近期消息，SQLite 保留每轮完成的问答原文。

每个新问题只加载一次会话历史快照。默认工作窗口为 32,768 tokens，输出预留 4,096。开场输入超过高水位 24,000 时，按完整问答压缩旧历史，在同一份快照上更新摘要并重新估算，直至输入降到 14,000 以内。若系统规则和当前问题已超过低水位，优先保留这些必要内容；开场必要内容超过高水位时提示分段提问。旧摘要的归档边界按会话保存。

同一问题内，工具调用和结果追加到内存中的同一份 `messages`。每次发送前累计新增消息，并计入当前工具定义和系统提示。循环输入可用到 28,160 tokens（默认窗口扣除回复预算和 512 tokens 的估算余量）。超出预算时先缩短本轮工具正文，保留调用 ID、退出码和来源。裁剪后仍超限时提示缩小任务范围。历史压缩留到下个新问题；显式调用历史回读工具时仍按消息 ID 取原文。

摘要存在 SQLite 的 `chat_summaries` 表中，带有本会话的来源消息编号。模型可以通过 `search_tools` 发现 `read_chat_messages` 并按编号核对原文。可在 `backend/.env` 中设置 `CHAT_CONTEXT_WINDOW` 和 `CHAT_MAX_OUTPUT_TOKENS`，重启后端生效。工作窗口应在所用模型的上下文上限以内。本地 token 估算与服务商的实际计数可能有差异。

字幕下载完成后会自动写入混合索引；删除任务时会同步删除对应索引。
已有字幕的关键词索引会从 SQLite 保存的原文自动迁移，Chroma 向量可以继续使用。

### 可选的远程会话沙箱

Chat 通过 `search_tools` 发现 `sandbox_exec`。后端绑定当前页签的 `thread_id`，通过 HTTP 把命令交给 Runner。Runner 在第一次调用时创建容器，此后复用该页签的 `/workspace`。每条命令是独立进程，工作区文件可跨轮读取。每次返回标准输出、错误、退出码、截断标记及执行编号。

首次部署需要 Linux 服务器、systemd、Docker、Python 3.11+、pip 和 nftables（`nft`）。把 `deploy/sandbox/` 中的文件复制到服务器的临时目录，在该目录以管理员身份运行 `sh install.sh`。安装脚本将程序及依赖放在 `/opt/vksummary-sandbox`，SQLite 状态保存在 `/var/lib/vksummary-sandbox`。Runner 只监听服务器的 `127.0.0.1:15051`，模型和任务容器都无法访问 Docker socket。这个版本面向个人本机 Chat，前后端仅供受信任用户访问。

在本机项目的 `.secrets/` 中放入专用 SSH 私钥 `vksummary_sandbox_deploy_ed25519`、经过指纹核对的 SSH 主机记录 `vksummary_sandbox_known_hosts`，并经 SSH 安全复制服务器的 `/opt/vksummary-sandbox/runner.token` 到本机 `.secrets/runner.token`。在 `backend/.env` 里设置 `SANDBOX_RUNNER_URL=http://127.0.0.1:15051`，重启后端。在项目根目录的 Windows CMD 中运行下面的命令并保留该窗口（将示例主机名和用户名换成自己的）。

```cmd
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy\sandbox\connect.ps1 -Server your-server -Login your-ssh-user
```

工作区使用项目专用的 Docker 网桥直接访问 IPv4 公网。Python 可请求公网 API，pip 和 apk 默认通过 HTTPS 直连阿里云镜像，也可指定其他公网软件源。宿主机入站与私网目的地址的限制只作用于本项目网桥，不发布容器端口。Chat 到 Runner 的 SSH 端口转发独立于容器的上网流量。

例如，让 Chat 执行 `pip download --no-deps six==1.17.0` 可把 wheel 下载到当前工作区。执行 `pip install --target /workspace/lib six==1.17.0` 后，同一会话的 Python 就能导入它。Alpine 软件包可用 `apk fetch --no-cache mariadb-client` 下载。系统目录只读，运行用户为非 root；数据库服务安装与初始化属于另一项功能。

每个工作区可写入 16 MiB，默认最多同时保留两个，命令串行执行。直接运行 `apk`、`pip` 或 `python -m pip` 时限为 90 秒，普通命令限时 20 秒。超时会回收整代工作区，空闲满 30 分钟后也会回收。升级时正在运行的旧工作区沿用原镜像至回收，后续创建的工作区使用新版镜像。

---

## 数据与日志

- 运行数据（`backend/data/`）与日志（`backend/app/logs/`）均已加入 `.gitignore`。
- `backend/data/chat_index/` 存放 Chat 索引数据（Chroma、SQLite、meta 等）。
- 密钥配置在 `backend/.env`（已 gitignore），请勿提交真实 Cookie 与 API Key。
