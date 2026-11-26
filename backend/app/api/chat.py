# -*- coding: utf-8 -*-
"""Chat 相关 API。"""

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.models import QueryParam
from services import chat_service
from utils import retrieve

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/chat",
    tags=["chat相关操作"],
)


def _require_thread(thread_id: str):
    if not retrieve.chat_thread_exists(thread_id):
        raise HTTPException(status_code=404, detail="对话不存在")


@router.get("/threads")
def list_threads():
    return {"data": retrieve.list_chat_threads()}


@router.post("/threads", status_code=201)
def create_thread():
    return retrieve.create_chat_thread()


# 进行对话流式输出
@router.post("/query")
def query(queryparam: QueryParam):
    _require_thread(queryparam.thread_id)
    return StreamingResponse(
        chat_service.stream_chat(queryparam.query, thread_id=queryparam.thread_id),
        media_type="text/event-stream",
    )


# 获取历史数据展示在页面中
@router.get("/history")
def get_chat_history(thread_id: str = "default"):
    _require_thread(thread_id)
    try:
        history = chat_service.get_chat_history(50, thread_id=thread_id)
        return {"data": history}
    except Exception as e:
        logger.error(f"获取chat历史数据错误: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取chat历史数据失败")
