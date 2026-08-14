from langchain.agents import create_agent
from langchain_core.messages import HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
from agent_framework.state import AgentState
import config
from agent_framework.prompts.revise_prompts import REVISE_KNOWLEDGE_PROMPT
from utils import queue_utils
from utils.json_repair import repair_and_parse_json
import asyncio
import json

import logging

logger = logging.getLogger(__name__)

envs = config.get_env_param()
llm = ChatOpenAI(
    model = envs['model'],
    base_url = envs['base_url'],
    api_key = envs['api_key']
)


agent = create_agent(
    model=llm,
    tools=[],
    system_prompt="你是一个知识框架修订员。审核员对知识框架提出了批注（issues），你的任务是根据批注逐条修订，输出**修正后的完整知识框架**。"
)

# 修复agent，针对审查结果修复内容
async def revise_agent(state: AgentState) -> dict:
    try:
        # -- 1.发送sse日志 --
        bvid_uid = state["bvid_uid"]
        msg = {"bvid_uid": bvid_uid, "phase": "agent", "message": "正在使用agent根据审核结果修正知识框架...", "done": False, "error": None}
        queue_utils.publish(bvid_uid, msg)

        logger.info(f"- {bvid_uid}任务：正在使用agent根据审核结果修正知识框架... -")

        # 构造消息
        subtitles = state["subtitles"]
        framework = state.get("cur_output", {})
        issues = state["review_output"]
        framework_str = json.dumps(framework, ensure_ascii=False)
        issues_str = json.dumps(issues, ensure_ascii=False)
        messages = [
            HumanMessage(content=REVISE_KNOWLEDGE_PROMPT.replace("{subtitles}", subtitles).replace("{framework}", framework_str).replace("{issues}", issues_str))
        ]

        # -- 2.启动agent执行任务 --
        response = None
        max_retries = 2     # 出错重试2次
        for attempt in range(max_retries):
            try:
                response = await agent.ainvoke({"messages":messages})
                break  # 成功，跳出重试循环
            except Exception as e:
                logger.warning(
                    f"[{bvid_uid}] LLM 调用失败 (第 {attempt + 1}/{max_retries} 次): {e}"
                )
                if attempt < max_retries - 1:
                    wait_sec = 2 ** attempt  # 1s, 2s, 4s 指数退避
                    msg = {
                        "bvid_uid": bvid_uid, "phase": "agent",
                        "message": f"LLM 服务繁忙，{wait_sec}s 后重试（{attempt + 1}/{max_retries}）...",
                        "done": False, "error": None,
                    }
                    queue_utils.publish(bvid_uid, msg)
                    await asyncio.sleep(wait_sec)
                else:
                    raise  # 重试耗尽，抛出异常由外层 except 处理

        raw = response["messages"][-1].content

        # -- 3.兜底修复json --
        parsed = repair_and_parse_json(raw)

        # -- 4.循环次数+1 --
        loop_count = state.get("loop_count", 0)
        loop_count += 1

        return {"revise_output": parsed, "cur_output": parsed, "loop_count": loop_count, "messages": [AIMessage(content=raw, name="revise_agent")]}

    except Exception as e:
        logger.error(f"[{bvid_uid}] Agent 任务在revise阶段失败: {e}", exc_info=True)
        raise
