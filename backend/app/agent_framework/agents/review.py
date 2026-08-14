from langchain.agents import create_agent
from langchain_core.messages import HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
from agent_framework.state import AgentState
import config
from agent_framework.prompts.review_prompts import REVIEW_QUALITY_PROMPT
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
    system_prompt="你是一个严格的知识框架审核员。你的任务是对提取出的知识框架草稿进行批判性审查，找出问题并打分。**score >= 0.8 才算通过（approved=true）**。"
)

# 审查agent，审查解析的字幕内容是否存在问题
async def review_agent(state: AgentState) -> dict:
    try:
        # -- 1.发送sse日志 --
        bvid_uid = state["bvid_uid"]
        msg = {"bvid_uid": bvid_uid, "phase": "agent", "message": "正在使用agent审查解析出来的内容...", "done": False, "error": None}
        queue_utils.publish(bvid_uid, msg)

        logger.info(f"- {bvid_uid}任务：正在使用agent审查解析出来的内容... -")

        # 构造消息
        subtitles = state["subtitles"]
        framework = state.get("cur_output", {})
        framework_str = json.dumps(framework, ensure_ascii=False)    # 转换成字符串再替换到prompt中，要不然dict不能替换str
        messages = [
            HumanMessage(content=REVIEW_QUALITY_PROMPT.replace("{subtitles}", subtitles).replace("{framework}", framework_str))
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

        return {"review_output": parsed, "messages": [AIMessage(content=raw, name="review_agent")]}

    except Exception as e:
        logger.error(f"[{bvid_uid}] Agent 任务在review阶段失败: {e}", exc_info=True)
        raise
