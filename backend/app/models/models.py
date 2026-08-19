# backenc/app/models/models.py
# pydantic的模型定义

from pydantic import BaseModel
from typing import Optional

# 环境变量参数模型
class EnvParam(BaseModel):
    sessdata: str
    bili_jct: str
    buvid3: str
    model: str
    base_url: str
    api_key: str

# 视频url参数
class VideoUrlParam(BaseModel):
    video_url: str

# 视频的pages参数
# pages中包含每个视频的cid等详细信息
class VideoPagesParam(BaseModel):
    bvid: str
    pages: list[dict]


# chat中提问
class QueryParam(BaseModel):
    query: str    