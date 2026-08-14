from fastapi import APIRouter, Depends, HTTPException
import re
import os
import logging
from services import video_resolver
from models.models import VideoUrlParam, VideoPagesParam
import uuid

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/video",
    tags=["视频相关操作"]
)

# 根据视频url获取视频信息
# 视频是 单视频 还是 集合视频
# 如果是集合视频，返回视频列表
@router.post("/get_video_info")
async def get_video_info(request: VideoUrlParam):
    try:
        video_url = request.video_url
        # 1.正则表达式提取出 BV 号 和 p 参数
        match = re.search(r'/video/([^?/]+)(?:\?.*?[&?]p=(\d+))?', video_url)
        # 1.1.添加匹配失败的判断
        if not match:
            logger.error(f"无法从 URL 提取 BV 号: {video_url}")
            raise HTTPException(status_code=400, detail="无效的视频 URL")
        bvid = match.group(1)
        p = int(match.group(2)) if match.group(2) else 1

        # 2.根据BV号 获取视频的详细信息，视频cid等信息
        video_info = await video_resolver.get_video_info(bvid)

        logger.info(f"- /api/video/get_video_info GET -BV: {bvid}-视频信息获取成功")
        return {
            "bvid": bvid,
            "video_type": video_info["video_type"],   # single OR multi
            "current_page": p,
            "pages": video_info["pages"]
        }

    except Exception as e:
        logger.error(f"BV: {bvid}获取视频信息失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取视频信息失败")


# ***
# 获取视频的字幕,然后保存到 data/subtitles 文件夹中
# 如果单个视频直接传单个视频
# 如果是多个视频，选一个视频，就传选中的视频
# 如果是多个视频全部，传全部视频
# 传参：bvid: str     pages: list[dict]
# ***
@router.post("/start_video_subtitles")
async def start_video_subtitles(request: VideoPagesParam):
    # 启动字幕下载任务，立即返回 bvid_uid， 然后前端轮询请求别的接口查看下载进度
    try:
        # 获取请求中的视频信息列表
        bvid = request.bvid
        pages = request.pages
        
        # 后台启动字幕下载任务和agent任务，立即返回 bvid_uid，防止请求下载字幕时间太长http连接时长太长
        bvid_uid = await video_resolver.start_subtitle_download(bvid, pages)

        logger.info(f"- /api/video/start_video_subtitles POST -字幕任务启动: {bvid_uid}, 共 {len(pages)} 集")

        return {
            "bvid_uid": bvid_uid,   # 唯一id
            "bvid": bvid
        }
    
    except Exception as e:
        logger.error(f"BV: {bvid}启动字幕任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="启动字幕下载失败")


