import asyncio
import logging

logger = logging.getLogger(__name__)

# 全局任务队列字典: {bvid_uid: asyncio.Queue}
_queues: dict[str, asyncio.Queue] = {}


# ***
# 发布消息
# 调用 publish 时若队列不存在则自动创建，保证消息不会丢失
# ***
def publish(bvid_uid: str, message: dict):
    try:
        if bvid_uid not in _queues:
            _queues[bvid_uid] = asyncio.Queue()
        _queues[bvid_uid].put_nowait(message)
        logger.info(f"队列{bvid_uid}: 写入消息：{message}")
    except Exception as e:
        logger.error(f"发布消息失败 [{bvid_uid}]: {e}", exc_info=True)



# ***
# 异步订阅消息
# 先从已有队列中消费所有未读消息，再等待新消息
# ***
async def subscribe(bvid_uid: str): 
    if bvid_uid not in _queues:
        _queues[bvid_uid] = asyncio.Queue()

    queue = _queues[bvid_uid]

    # 从队列获取数据
    data = await queue.get()

    return data

# ***
# 清理队列
# ***
def cleanQueue(bvid_uid: str):
    _queues.pop(bvid_uid, None)
    logger.info(f"队列：{bvid_uid}：已清空删除")
