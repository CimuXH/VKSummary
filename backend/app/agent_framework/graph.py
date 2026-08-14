# 状态图构建
from langgraph.graph import StateGraph, START, END
from agent_framework.state import AgentState
from agent_framework.agents.extract import extract_agent
from agent_framework.agents.review import review_agent
from agent_framework.agents.revise import revise_agent

# 条件函数：评审通过或者达到最大循环次数则循环结束，否则继续修订
def decide_after_review(state: AgentState) -> str :
    approved = state.get("review_output", {}).get("approved", False)

    # 如果审查通过 或 循环次数达到3次
    if approved or state.get("loop_count", 0) >= 3:
        return "end"
    return "revise"

# 构建条件图
def build_graph():
    builder = StateGraph(AgentState)

    # 添加节点
    builder.add_node("extract", extract_agent)
    builder.add_node("review", review_agent)
    builder.add_node("revise", revise_agent)
    
    # 添加边
    builder.add_edge(START, "extract")
    builder.add_edge("extract", "review")
    builder.add_conditional_edges(
        "review",
        decide_after_review,
        {"revise": "revise", "end": END},
    )
    builder.add_edge("revise", "review")

    return builder.compile()