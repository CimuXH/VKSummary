# app/api/settings.py
# 从前端加载环境变量参数用的接口（）

from fastapi import APIRouter, Depends, HTTPException
from models.models import EnvParam
import config
import logging
from langchain_openai import ChatOpenAI
import requests
from bilibili_api import Credential


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/settings",
    tags=["加载参数使用"]
)

# 从前端获取环境变量参数
# sessdata, bili_jct, buvid3 
@router.post("/set_env_param")
async def set_env_param(envparam: EnvParam):
    try:
        # 保存环境变量到.env中
        config.set_env_param(envparam)
        logger.info(f"- /api/env_param POST -环境变量保存成功: {envparam}")
        return {"status": "success", "messafe": "环境变量保存成功"}
    except Exception as e:
        logger.error(f"保存环境变量失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="保存环境变量失败")

# 从后端获取环境变量参数
# 环境变量参数返回给前端
@router.get("/get_env_param")
async def get_env_param():
    try:
        # 从.env中获取环境变量参数
        env_dict = config.get_env_param()
        logger.info(f"- /api/get_env_param GET -环境变量获取成功: {env_dict}")
        return env_dict
    except Exception as e:
        logger.error(f"获取环境变量失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取环境变量失败")

# 测试环境变量是否可用
# 要兼容OpenAI API格式的模型
@router.post("/test_env")
async def test_env(envparam: EnvParam):
    llmcheck = True
    cookiecheck = True
    
    # 验证llm参数是否有效
    try:
        # 从前端获取环境变量参数
        model = envparam.model
        base_url = envparam.base_url
        api_key = envparam.api_key
        llm = ChatOpenAI(model=model, base_url=base_url, api_key=api_key)
        
        # 测试模型是否可用
        response = await llm.ainvoke("你好，你也输出你好")
        logger.info(f"- /api/test_env GET -llm环境变量测试成功: {response}")
        
    except Exception as e:
        logger.error(f"llm测试环境变量失败: {e}", exc_info=True)
        llmcheck = False
    
    # 验证bilibili的cookie是否有效
    try:
        # 从前端获取环境变量参数
        credential = Credential(
            sessdata = envparam.sessdata,
            bili_jct = envparam.bili_jct,
            buvid3 = envparam.buvid3
        )
        
        is_valid = await credential.check_valid()

        if is_valid:
            logger.info(f"- /api/test_env POST -bilibili cookie测试环境变量成功: {is_valid}")
        else:
            cookiecheck = False
            logger.info(f"- /api/test_env POST -bilibili cookie测试环境变量失败: {is_valid}")

    except Exception as e:
        logger.error(f"bilibili cookie测试环境变量失败: {e}", exc_info=True)
        cookiecheck = False

    # 全部验证成功
    if llmcheck and cookiecheck:
        return {"status": "success", "message": "环境变量测试成功"}

    if not llmcheck:
        if not cookiecheck:
            raise HTTPException(status_code=500, detail="llm和bilibili cookie测试环境变量失败")
        else:
            raise HTTPException(status_code=500, detail="llm测试环境变量失败")
    if not cookiecheck:
        raise HTTPException(status_code=500, detail="bilibili cookie测试环境变量失败")
