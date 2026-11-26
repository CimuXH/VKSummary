"""Chat 工具的注册、发现和参数校验。"""

import logging
from dataclasses import dataclass
from typing import Callable

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from utils import retrieve
from services.sandbox_client import sandbox_exec

logger = logging.getLogger(__name__)
DISCOVERY_NAME = "search_tools"


@dataclass(frozen=True)
class Tool:
    description: str
    arguments: type[BaseModel]
    handler: Callable[..., dict]
    keywords: tuple[str, ...] = ()

    def definition(self, name: str) -> dict:
        return {
            "type": "function",
            "function": {
                "name": name,
                "description": self.description,
                "parameters": self.arguments.model_json_schema(),
            },
        }


class ToolArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SearchToolsArgs(ToolArgs):
    query: str = Field(default="", max_length=120, description="工具的用途或名称，如「字幕检索」。留空可查看目录。")


class SearchSubtitlesArgs(ToolArgs):
    query: str = Field(min_length=1, max_length=300, description="要在已保存的字幕里查找的关键词或问题。")


class ReadMessagesArgs(ToolArgs):
    ids: list[int] = Field(min_length=1, max_length=4, description="摘要引用的消息编号，如 M19 填 [19]。")
    offset: int = Field(ge=0, default=0, description="原文字符偏移，续读长消息时填上次返回的 next_offset。")


class SandboxArgs(BaseModel):
    # 命令参数和标准输入可能包含有意义的空白，不能套用 ToolArgs 的自动 strip。
    model_config = ConfigDict(extra="forbid")
    argv: list[str] = Field(min_length=1, max_length=128, description="程序和参数。管道可显式使用 sh -c。")
    stdin: str = Field(default="", max_length=65536, description="传给程序的标准输入，可省略。")


def search_tools(query: str = "") -> dict:
    query = query.casefold()
    matches = []
    for name, tool in TOOLS.items():
        keywords = (name, *tool.keywords)
        score = max((len(word) for word in keywords if word.casefold() in query), default=0)
        if not query or score:
            matches.append((score, name))
    matches.sort(key=lambda item: (-item[0], item[1]))
    return {
        "tools": [
            {"name": name, "description": TOOLS[name].description}
            for _, name in matches[:3]
        ],
    }


def search_subtitles(query: str) -> dict:
    matches = []
    for row in retrieve.hybrid_search(query):
        url = row["source_url"]
        if url and row["page"]:
            url += f"?p={row['page']}"
        matches.append({
            "content": row["content"],
            "bvid": row["bvid"],
            "page": row["page"],
            "part": row["part"],
            "source_url": url,
        })
    return {"matches": matches}


TOOLS = {
    "sandbox_exec": Tool(
        description="在本对话临时 Linux 工作区执行命令，/workspace 文件跨轮保留。可用 sh、Python 直接访问公网、下载文件，用 pip install --target /workspace/lib 安装 Python 包。系统目录只读。返回输出、错误、退出码及截断标志。",
        arguments=SandboxArgs,
        handler=sandbox_exec,
        keywords=("沙箱", "工作区", "运行", "执行", "命令", "文件", "代码", "下载", "软件源", "安装", "pip", "apk", "shell", "python", "sandbox", "terminal"),
    ),
    "read_chat_messages": Tool(
        description="按消息 ID 回读本次对话的历史原文，核对摘要中的细节。",
        arguments=ReadMessagesArgs,
        handler=retrieve.read_chat_messages,
        keywords=("原文", "历史", "消息", "摘要", "回读", "memory", "history"),
    ),
    "search_subtitles": Tool(
        description="检索已保存的 B 站视频字幕，返回相关片段、分集和来源链接。",
        arguments=SearchSubtitlesArgs,
        handler=search_subtitles,
        keywords=("字幕", "视频", "知识库", "B站", "bilibili", "subtitle", "rag"),
    ),
}

DISCOVERY_TOOL = Tool(
    description="按用途或名称查找当前可用的工具，最多返回三个候选。需要使用工具时先调用本工具。",
    arguments=SearchToolsArgs,
    handler=search_tools,
)


def run_tool(available: dict[str, Tool], name: str, arguments: str, *, thread_id: str) -> dict:
    tool = available.get(name)
    if tool is None:
        return {"error": "此工具当前不可用。请先调用 search_tools 搜索。"}
    try:
        args = tool.arguments.model_validate_json(arguments)
        params = args.model_dump()
        if name in {"read_chat_messages", "sandbox_exec"}:
            params["thread_id"] = thread_id  # 绑定当前请求，模型无法指定其他会话。
        return tool.handler(**params)
    except ValidationError as exc:
        return {"error": "工具参数不符合定义。", "details": exc.errors(
            include_input=False, include_url=False, include_context=False,
        )}
    except Exception:
        logger.exception("Chat 工具执行失败: %s", name)
        return {"error": "工具执行失败。"}
