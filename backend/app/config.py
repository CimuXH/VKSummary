# backend/app/config.py
import os
from pathlib import Path
from dotenv import load_dotenv, set_key
from models.models import EnvParam

# 获取当前文件 (config.py) 所在的目录: /path/to/backend/app
current_dir = Path(__file__).parent
backend_dir = current_dir.parent
ENV_FILE = backend_dir / ".env"

# 加载环境变量
load_dotenv(ENV_FILE)

# 设置环境变量, 并保存到 .env 文件
def set_env_param(envparam: EnvParam):
    env_dict = {
        "sessdata": envparam.sessdata,
        "bili_jct": envparam.bili_jct,
        "buvid3": envparam.buvid3,
        "model": envparam.model,
        "base_url": envparam.base_url,
        "api_key": envparam.api_key,
    }
    for key, value in env_dict.items():
        os.environ[key] = value
        # 使用确定好的 ENV_FILE 路径保存
        set_key(str(ENV_FILE), key, value)

# 获取环境变量参数
def get_env_param():
    env_dict = {
        "sessdata": os.getenv("sessdata"),
        "bili_jct": os.getenv("bili_jct"),
        "buvid3": os.getenv("buvid3"),
        "model": os.getenv("model"),
        "base_url": os.getenv("base_url"),
        "api_key": os.getenv("api_key"),
    }
    return env_dict