# vksummary — 视频内容知识总结

输入一个 B 站视频链接，自动拉取字幕，并调用 LLM 把字幕提炼成**结构化知识框架（思维导图）**，让你不用看视频也能快速掌握知识点。后期计划补充 LLM Chat 功能，把已总结的知识框架作为外置知识库问答。

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
- **环境配置**：页面内配置 LLM 参数与 B 站 Cookie，并一键测试连通性。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python + FastAPI + Uvicorn（端口 `5000`） |
| Agent 编排 | LangGraph（`extract → review → revise` 条件循环） |
| LLM | `langchain` / `langchain_openai`（兼容 OpenAI API 格式） |
| 视频/字幕 | `bilibili-api-python` |
| 前端 | React 18 + Vite（端口 `3000`）+ Tailwind CSS |
| 实时通信 | SSE（Server-Sent Events） |
| 存储 | 文件系统（`backend/data/`，无数据库） |

---

## 目录结构

```
vksummary/
├── backend/app/             # FastAPI 入口、api/、services/、agent_framework/（三节点图 + 三个 agent）、utils/
├── backend/requirements.txt # Python 依赖清单
├── backend/data/            # 运行时生成：subtitles/ 字幕、summary_subtitles/ 结果 JSON（已 gitignore）
├── backend/.env.example     # 环境变量模板（实际 .env 已 gitignore）
└── frontend/                # React + Vite，src/components/ 含各面板组件
```

---

## 环境要求

- Python 3.10+（推荐 3.11 / 3.12）
- Node.js 18+
- 一个**兼容 OpenAI API 格式**的 LLM 服务（提供 `model` / `base_url` / `api_key`）
- 可用的 **B 站登录 Cookie**（`sessdata` / `bili_jct` / `buvid3`），用于拉取字幕

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

---

## 工作原理

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

---

## 数据与日志

- 运行数据（`backend/data/`）与日志（`backend/app/logs/`）均已加入 `.gitignore`。
- 密钥配置在 `backend/.env`（已 gitignore），请勿提交真实 Cookie 与 API Key。

---

## 规划

- [ ] LLM Chat：以已总结的知识框架作为外置知识库问答。
