from asyncio import CancelledError

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
import re
import os
import logging
from services import video_resolver
from utils import queue_utils
import json
from pathlib import Path

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/task",
    tags=["agent任务相关操作"]
)

# ***
# 前端sse获取任务进度
# ***
@router.get("/sse/{bvid_uid}")
async def sse(request: Request, bvid_uid: str):
    async def generate():
        try:
            while True:
                if await request.is_disconnected(): # 是协程，要用await
                    queue_utils.cleanQueue(bvid_uid)
                    break
                # 循环从队列中消费消息给前端
                data = await queue_utils.subscribe(bvid_uid)    # 有可能在这里阻塞的时候前端断开sse，所以加上except的内容
                yield f"data: {json.dumps(data)}\n\n"
        except CancelledError:
            queue_utils.cleanQueue(bvid_uid)

    return StreamingResponse(generate(), media_type="text/event-stream")

# ***
# 根据bvid_uid 获取任务的总结结果json内容
# ***
@router.get("/task_response/{bvid_uid}")
async def task_response(bvid_uid: str):
    try:
        file_path = Path(__file__).parent.parent.parent / "data" / "summary_subtitles" / f"{bvid_uid}.json"

        
        with open(file_path, "r", encoding='utf-8') as f:
            data = json.load(f)

        logger.info(f"- /api/task/task_response/{bvid_uid} -请求任务总结结果成果")

        return {
            "bvid_uid": bvid_uid,
            "data": data
        }

    
    except Exception as e:
        logger.error(f"BVUID: {bvid_uid}获取该任务的总结结果失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取该任务的总结结果失败")

# ***
# 获取已经总结完成的任务列表，用于页面最左侧展示选择
# ***
@router.get("/all_task_list")
async def all_task_list():
    try:
        data_list = []
        # 读取summary_subtitles文件夹中的所有文件
        folder_path = Path(__file__).parent.parent.parent / "data" / "summary_subtitles"
        for file_path in folder_path.iterdir():
            if file_path.is_file() and file_path.suffix == ".json":
                try:
                    with open(file_path, "r", encoding='utf-8') as f:
                        data = json.load(f)
                        newdata = {
                            "bvid_uid": file_path.stem, 
                            "type":data.get("type", "未知类型"), 
                            "title":data.get("title", "无标题")
                            }
                        data_list.append(newdata)
                except json.JSONDecodeError as e:
                    logger.warning(f"跳过损坏的文件 {file_path.name}: {e}")
                    continue
                except Exception as e:
                    logger.error(f"读取失败 {file_path.name}: {e}")
                    continue 

        logger.info(f"- /api/task/all_task_list -获取已总结完成任务列表成功, 共 {len(data_list)} 条")
        return {"data": data_list}

    except Exception as e:
        logger.error(f"请求已完成任务列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="请求已完成任务列表失败")



# ***
# 根据bvid_uid删除某个已完成的任务
# ***
@router.delete("/finished_task/{bvid_uid}")
async def delete(bvid_uid: str):
    summary_subtitles_path = Path(__file__).parent.parent.parent / "data" / "summary_subtitles" / f"{bvid_uid}.json"
    subtitles_path = Path(__file__).parent.parent.parent / "data" / "subtitles" / f"{bvid_uid}.md"

    # 如果任务存在则删除，
    deleted = 0
    try:
        if os.path.exists(summary_subtitles_path):
            os.remove(summary_subtitles_path)
            deleted += 1
        if os.path.exists(subtitles_path):
            os.remove(subtitles_path)    
            deleted += 1
    except Exception as e:
        logger.error(f"删除任务文件失败 {bvid_uid}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"删除文件失败: {e}")

    # 如果不存在，报错404
    if deleted == 0:
        raise HTTPException(status_code=404, detail="该任务不存在")

    # 删除成功返回信息
    logger.info(f"{bvid_uid} 对应文件已删除: {deleted}")
    return {"bvid_uid": bvid_uid, "message": "删除成功", "deleted": deleted}