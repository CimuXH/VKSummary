# -*- coding: utf-8 -*-
"""Chat 服务：混合检索 + 历史消息 + LLM 流式输出。"""

import json
import logging

import config
from openai import OpenAI
from utils import retrieve

logger = logging.getLogger(__name__)

envs = config.get_env_param()
client = OpenAI(
    api_key=envs["api_key"],
    base_url=envs["base_url"],
)


def build_prompt(question: str, reference: str) -> str:
    """拼接最终 Prompt。"""
    reference_str = reference or "（没有检索到相关参考内容）"

    return f"""# 角色
        你是一个跨领域知识专家。

        # 任务
        基于用户问题、历史消息和提供的参考内容回答问题。

        # 要求
        - 回答简洁明了，直击重点
        - 优先使用参考内容中的信息
        - 如果参考内容不足，基于你的知识补充
        - 避免冗余和模糊表述

        # 用户问题:
        {question}

        # 参考内容:
        {reference_str}
            """


async def stream_chat(question: str):
    """流式回答：检索 → 拼接历史 → 调用 LLM → SSE 输出。"""
    # 1. 混合检索知识库
    results = retrieve.hybrid_search(question)
    reference = "\n".join(item["content"] for item in results)

    # 2. 获取部分最近对话历史
    history = retrieve.get_recent_messages()

    # 3. 拼接 Prompt
    prompt = build_prompt(question, reference)

    messages = [{
        "role": "system",
        "content": "you are a helpful assistant",
    }]
    for item in history:
        messages.append({"role": item["role"], "content": item["content"]})
    messages.append({"role": "user", "content": prompt})


    # 5. 流式调用 LLM
    try:
        response = client.chat.completions.create(
            model=envs["model"],
            messages=messages,
            stream=True,
        )

        answer = ""
        for chunk in response:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                answer += delta
                yield f"data: {json.dumps({'type': 'delta', 'delta': delta}, ensure_ascii=False)}\n\n"

        # 6. 保存本轮问答，只保留最近 20 条
        retrieve.save_chat_messages(question, answer)

        yield f"data: {json.dumps({'type': 'done', 'answer': answer}, ensure_ascii=False)}\n\n"

    except Exception as e:
        logger.error(f"Chat 流式输出失败: {e}", exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"


# 获取历史数据消息
def get_chat_history(num: int):
    history = retrieve.get_recent_messages(num)
    return history