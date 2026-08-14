# LangGraph State 定义（仅 LLM 相关字段）
from typing import TypedDict, List, Annotated
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

class AgentState(TypedDict):
    bvid_uid: str
    subtitles: str  # 原始字幕内容
    
    loop_count: int     # 评审/修改次数
    extract_output: dict    # 总结字幕结果
    review_output: dict     # 审查问题描述
    revise_output: dict     # 总结字幕结果

    cur_output: dict      # 当前的字幕结果

    messages: Annotated[List[BaseMessage], add_messages]  # 设置message自动追加到列表中