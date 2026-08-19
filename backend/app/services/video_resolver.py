import asyncio
import json
import os
from bilibili_api import video, Credential, sync
from dotenv import load_dotenv
import uuid
from pathlib import Path
import httpx
import logging
from utils import queue_utils
from utils import retrieve

logger = logging.getLogger(__name__)

load_dotenv()

# https://www.bilibili.com/video/BV1FDSLBMEdz/?spm_id_from=333.337.search-card.all.click&vd_source=d5065f572ed2b9526091c99972143ab9
# https://www.bilibili.com/video/BV1F5411J7vK?spm_id_from=333.788.videopod.episodes&vd_source=d5065f572ed2b9526091c99972143ab9&p=2


# 根据bvid获取视频的相关信息
# 视频是 单视频 还是 集合视频
# 如果是集合视频，返回视频列表
async def get_video_info(bvid: str):
    try:
        sessdata = os.getenv("sessdata")
        bili_jct = os.getenv("bili_jct")
        buvid3 = os.getenv("buvid3")
        # 1.实例化 Credential 类 和 Video 类
        credential = Credential(sessdata=sessdata, bili_jct=bili_jct, buvid3=buvid3)
        v = video.Video(bvid=bvid, credential=credential)
        
        # 2.获取视频详细信息，拿到cid
        info = await v.get_info()

        # 3.判断视频数量
        v_num = info["videos"]
        if v_num == 1:
            pages = info["pages"]
            return {
                "bvid": bvid,
                "video_type": "single",
                "pages": pages
            }
        else:
            pages = info["pages"]
            return {
                "bvid": bvid,
                "video_type": "multi",
                "pages": pages
            }

    except Exception as e:
        raise e


# ***
# 字幕下载任务进度内存存储
# ***
_background_tasks: set = set()      # 后台任务id
# -----queue中的数据
# bvid_uid: str
# phase: str                  # subtitles agent done三个截断
# message: str
# done: bool                  # 每个阶段是否完成
# error: Optional[str] = None # 可以是None，默认是None
# ------

# ***
# 启动后台字幕下载任务
# ***
async def start_subtitle_download(bvid:str, pages: list[dict]):
    # 启动后台字幕下载任务，理解返回 bvid_uid
    
    # 1.根据bvid和uuid生成唯一文件名
    uid = uuid.uuid4()
    bvid_uid = f"{bvid}_{uid}"  # 唯一id
    try:    
        file_path = Path(__file__).parent.parent.parent / "data" / "subtitles" / f"{bvid_uid}.md"

        # 3.启动后台任务 （保持引用防止被 GC）
        task = asyncio.create_task(_download_all_subtitles(bvid, pages, bvid_uid, file_path))
        _background_tasks.add(task)     # 保存到后台任务id中
        task.add_done_callback(_background_tasks.discard)   # 任务完成自动删除该任务

        # 让出控制权，让task任务被启动一下，然后快速拿回控制权去返回api，
        # 可以不加，因为：
        # fastapi的底层会让事件循环永远在运行
        # await asyncio.sleep(0)

        return bvid_uid
        

    except Exception as e:
        msg = {"bvid_uid": bvid_uid, "phase": "subtitles", "message": "后台字幕任务启动失败", "done": True, "error": str(e)}
        queue_utils.publish(bvid_uid, msg)
        raise e

# ***
# 真正的执行下载字幕任务，下载任务执行完成之后，自动启动 后台agent 任务
# ***
async def _download_all_subtitles(bvid: str, pages: list[dict], bvid_uid: str, file_path: Path):
    try:
        sessdata = os.getenv("sessdata")
        bili_jct = os.getenv("bili_jct")
        buvid3 = os.getenv("buvid3")
        # 1.实例化 Credential 类 和 Video 类
        credential = Credential(sessdata=sessdata, bili_jct=bili_jct, buvid3=buvid3)
        v = video.Video(bvid=bvid, credential=credential)

        # 2. 并发获取字幕（Semaphore 限制并发数防止封 IP）
        semaphore = asyncio.Semaphore(3)
        completed = 0

        # 单集字幕下载：返回 {has_subtitle, content, page, ...}
        # 单集无字幕/下载失败只标记跳过，不抛异常拖累其它分P
        async def fetch_one(page: dict) -> dict:
            # await asyncio.sleep(10) # 测试使用
            nonlocal completed
            cid = page.get("cid")
            page_no = page.get("page")
            try:
                async with semaphore:
                    # 2.1 根据 cid 获取字幕列表
                    sub_data = await v.get_subtitle(cid)
                    sub_list = sub_data.get("subtitles", [])

                    # 2.2 无字幕：直接返回标记，不报错
                    if not sub_list:
                        msg = {"bvid_uid": bvid_uid, "phase": "subtitles", "message": f"P{page_no} 无字幕", "done": False, "error": None}
                        queue_utils.publish(bvid_uid, msg)
                        return {"page": page_no, "part": page.get("part"), "has_subtitle": False, "content": None, "reason": "no_subtitle"}

                    first_sub = sub_list[0]
                    sub_url = first_sub.get("subtitle_url")
                    if not sub_url:
                        msg = {"bvid_uid": bvid_uid, "phase": "subtitles", "message": f"P{page_no} 无可用字幕", "done": False, "error": None}
                        queue_utils.publish(bvid_uid, msg)
                        return {"page": page_no, "part": page.get("part"), "has_subtitle": False, "content": None, "reason": "no_subtitle"}

                    # 2.3 补全 URL
                    if not sub_url.startswith("http"):
                        sub_url = "https:" + sub_url

                    # 2.4 异步请求字幕文件并解析
                    async with httpx.AsyncClient() as client:
                        resp = await client.get(sub_url)
                        raw_subtitles = resp.json()

                    # 提取纯文本内容
                    head = f"### part: {page.get('part')}, page: {page.get('page')}, cid: {page.get('cid')}"

                    result =  head + "\n" + " ".join([item["content"] for item in raw_subtitles.get("body", [])]) + "\n\n"

                    completed += 1
                    # 发布消息到队列中
                    msg = {"bvid_uid": bvid_uid, "phase": "subtitles", "message": f"字幕任务完成进度：{completed}/{len(pages)}", "done": False, "error": None}
                    queue_utils.publish(bvid_uid, msg)

                    return {"page": page_no, "part": page.get("part"), "has_subtitle": True, "content": result}

            except Exception as e:
                # 单集失败只记录并跳过，不影响其它分P；记录真实错误供汇总阶段判断
                logger.warning(f"[{bvid_uid}] P{page_no} 字幕下载失败: {e}")
                msg = {"bvid_uid": bvid_uid, "phase": "subtitles", "message": f"P{page_no} 字幕下载失败，已跳过", "done": False, "error": None}
                queue_utils.publish(bvid_uid, msg)
                return {"page": page_no, "part": page.get("part"), "has_subtitle": False, "content": None, "reason": "error", "error": str(e)}

        # 并发执行全部页面
        results = await asyncio.gather(*[fetch_one(p) for p in pages])
        ok_pages = [r for r in results if r["has_subtitle"]]
        no_sub_pages = [r for r in results if not r["has_subtitle"] and r.get("reason") != "error"]
        error_pages = [r for r in results if not r["has_subtitle"] and r.get("reason") == "error"]

        # 所有分P都失败
        if not ok_pages:
            if error_pages:
                # 接口异常（如凭证缺失/失效）：报真实错误，不误报"不存在字幕"
                err = str(error_pages[0].get("error", "未知错误"))[:150]
                if "sessdata" in err.lower() or "credential" in err.lower():
                    err = "B站登录凭证缺失或失效，请在 backend/app/.env 中配置 sessdata/bili_jct/buvid3"
                msg = {"bvid_uid": bvid_uid, "phase": "subtitles", "message": f"字幕获取失败: {err}", "done": True, "error": f"字幕获取失败: {err}"}
            else:
                # 确认所有分P都没有字幕
                msg = {"bvid_uid": bvid_uid, "phase": "subtitles", "message": "该视频不存在字幕", "done": True, "error": "该视频不存在字幕"}
            queue_utils.publish(bvid_uid, msg)
            logger.info(f"字幕下载结束（无可用字幕）: {bvid_uid}")
            return

        # 写入有字幕分P的内容
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.writelines([r["content"] for r in ok_pages])

        # 把字幕原始文件内容写入到chroma和sqlite的fts5表中，添加到知识库中
        chunks_len = retrieve.build_hybrid_index_for_file(file_path)
        logger.info(f"- {bvid_uid}: 的内容已经加入到chroma和sqlite的fts5表中")

        # 部分分P失败：无字幕与获取失败分开提示
        if no_sub_pages:
            skipped = "、".join(f"P{r['page']}" for r in no_sub_pages)
            msg = {"bvid_uid": bvid_uid, "phase": "subtitles", "message": f"共{len(pages)}集，{skipped} 无字幕已跳过", "done": False, "error": None}
            queue_utils.publish(bvid_uid, msg)
        if error_pages:
            failed = "、".join(f"P{r['page']}" for r in error_pages)
            msg = {"bvid_uid": bvid_uid, "phase": "subtitles", "message": f"{failed} 字幕获取失败，已跳过", "done": False, "error": None}
            queue_utils.publish(bvid_uid, msg)
        
        msg = {"bvid_uid": bvid_uid, "phase": "subtitles", "message": f"字幕任务已经完成，即将启动AI分析...", "done": True, "error": None}
        queue_utils.publish(bvid_uid, msg)
        logger.info(f"字幕下载完成: {bvid_uid}")

        # TODO: 调用agent后台任务
        logger.info(f"启动：{bvid_uid} Agent任务")
        from agent_framework import supervisor
        task = asyncio.create_task(supervisor.parse_subtitles(bvid_uid))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)




    except Exception as e:  # 不能写raise，因为上一层捕获不到，因为这是一个后台任务
        msg = {"bvid_uid": bvid_uid, "phase": "subtitles", "message": "后台字幕任务启动失败", "done": True, "error": str(e)}
        queue_utils.publish(bvid_uid, msg)
        logger.error(f"字幕下载失败 {bvid_uid}: {e}", exc_info=True)

        # 任务执行失败，删除该任务可能创建的字幕文件
        if os.path.exists(file_path):
            os.remove(file_path)
            retrieve.delete_hybrid_index_by_bvid_uid(bvid_uid)




if __name__ == '__main__':
    sessdata = os.getenv("sessdata")
    bili_jct = os.getenv("bili_jct")
    buvid3 = os.getenv("buvid3")
    # bvid = "BV1FDSLBMEdz"
    bvid = "BV1F5411J7vK"
    print(asyncio.run(get_video_info(bvid)))
    # bvid = "BV1FDSLBMEdz"
    # pages = [
    #     {
    #         "cid": 34322056989,
    #         "page": 1,
    #         "from": "vupload",
    #         "part": "Nginx是什么？Nginx高并发架构拆解指南（二）",
    #         "duration": 241,
    #         "vid": "",
    #         "weblink": "",
    #         "dimension": {
    #             "width": 1918,
    #             "height": 1080,
    #             "rotate": 0
    #         },
    #         "first_frame": "http://i1.hdslb.com/bfs/storyff/_00002a9671h865pwt2j2rhzo4l4l0sb_firsti.jpg",
    #         "ctime": 1764297586
    #     }
    # ]

    
