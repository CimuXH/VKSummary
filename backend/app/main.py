import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from api import video, settings, task, chat
import logging
import os


# ***
# 单文件日志处理器：超过 maxBytes 后直接清空重写，不保留备份文件。
# 说明：RotatingFileHandler(backupCount=0) 在 Python 3.12 下实测不会截断文件
# （doRollover 以追加模式重开），因此自定义此处理器。
# ***
class TruncatingFileHandler(logging.FileHandler):
    def __init__(self, filename, maxBytes, encoding=None):
        super().__init__(filename, mode='a', encoding=encoding)  # 追加模式，启动时不清历史
        self.maxBytes = maxBytes

    def emit(self, record):
        try:
            if self.stream is None:
                self.stream = self._open()
            # 达到上限：清空文件重新记录
            if self.maxBytes > 0 and os.path.getsize(self.baseFilename) >= self.maxBytes:
                self.stream.close()
                self.stream = open(self.baseFilename, 'w', encoding=self.encoding)
            super().emit(record)
        except Exception:
            self.handleError(record)

# **
# 配置日志
# **
def setup_logging():
    # 0. 确保 logs 目录存在
    current_dir = Path(__file__).parent
    logs_dir = current_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    run_log_path = logs_dir / "run.log"
    error_log_path = logs_dir / "error.log"
    
    # 1. 获取根记录器，设置最低级别为 DEBUG，确保所有级别都能被处理
    logger = logging.getLogger()
    if logger.handlers:
        return
    logger.setLevel(logging.INFO)

    # 2. 定义日志格式（可以根据需要调整）
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

    # 3. 创建记录所有日志（INFO及以上）的文件处理器
    # 注意：这里设置为 INFO，所以 DEBUG 级别的日志不会被写入
    # 单文件超过 maxBytes 后直接清空重写（不保留备份文件）
    all_handler = TruncatingFileHandler(run_log_path, maxBytes=10*1024*1024, encoding='utf-8')
    all_handler.setLevel(logging.INFO)
    all_handler.setFormatter(formatter)
    logger.addHandler(all_handler)

    # 4. 创建只记录错误日志（ERROR及以上）的文件处理器
    error_handler = TruncatingFileHandler(error_log_path, maxBytes=5*1024*1024, encoding='utf-8')
    error_handler.setLevel(logging.ERROR)  # 只记录 ERROR 和 CRITICAL
    error_handler.setFormatter(formatter)
    logger.addHandler(error_handler)

    # 5. 获取 uvicorn.access 记录器
    uvicorn_access_logger = logging.getLogger("uvicorn.access")
    uvicorn_access_logger.addHandler(all_handler)
    uvicorn_access_logger.setLevel(logging.INFO)

# 在 main.py 启动时调用一次
setup_logging()

# **
# 创建 FastAPI 应用
# **
app = FastAPI()

# **
# 配置 CORS，允许前端跨域访问
# **
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 开发阶段允许所有来源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# **
# 将子路由注册到主应用
# **
app.include_router(video.router)
app.include_router(settings.router)
app.include_router(task.router)
app.include_router(chat.router)

# **
# 状态检查接口
# **
@app.get("/")
async def root():
    return {"message": "API is running"}
@app.get("/api/health")
async def status():
    return {"status": "healthy"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)
