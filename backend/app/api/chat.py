# -*- coding: utf-8 -*-
"""Chat 相关 API。"""

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.models import QueryParam
from services import chat_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/chat",
    tags=["chat相关操作"],
)


# 进行对话流式输出
@router.post("/query")
async def query(queryparam: QueryParam):
    return StreamingResponse(
        chat_service.stream_chat(queryparam.query),
        media_type="text/event-stream",
    )


# 获取历史数据展示在页面中
@router.get("/history")
async def get_chat_history():
    try:
        history = chat_service.get_chat_history(50)
        return {"data": history}
    except Exception as e:
        logger.error(f"获取chat历史数据错误: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取chat历史数据失败")
