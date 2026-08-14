# 主控 Supervisor Agent
import json
import os
import logging
from pathlib import Path
from utils import queue_utils
from agent_framework.graph import build_graph

logger = logging.getLogger(__name__)

graph = build_graph()

async def parse_subtitles(bvid_uid: str):
    """解析字幕文件，调用 LLM 提取知识框架，结果写入 JSON 文件。

    整个流程被 try/except 包裹：无论成功还是失败，最终都会推送 phase="done"
    消息给前端，确保 SSE 不会永远挂起。
    """
    output_path = None
    try:
        msg = {"bvid_uid": bvid_uid, "phase": "agent", "message": "启动后台agent解析字幕任务", "done": False, "error": None}
        queue_utils.publish(bvid_uid, msg)

        # ── 1. 读取字幕文件 ──
        file_path = Path(__file__).parent.parent.parent / "data" / "subtitles" / f"{bvid_uid}.md"
        with open(file_path, "r", encoding='utf-8') as f:
            subtitles = f.read()

        # -- 2.启动图，得到运行结果--
        result = await graph.ainvoke({"bvid_uid": bvid_uid, "subtitles": subtitles, "loop_count": 0})
        parsed = result["cur_output"]

        # -- 3.结果写到json文件中 --
        # 附上来源视频链接，前端思维导图工具栏提供跳转入口
        parsed["source_url"] = f"https://www.bilibili.com/video/{bvid_uid.split('_')[0]}"
        output_path = Path(__file__).parent.parent.parent / "data" / "summary_subtitles" / f"{bvid_uid}.json"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(parsed, f, ensure_ascii=False, indent=2)

        logger.info(f"[{bvid_uid}] Agent 解析完成，结果已保存至 {output_path}")

        # ── 4. 成功完成 ──
        msg = {"bvid_uid": bvid_uid, "phase": "done", "message": "任务已经完成！", "done": True, "error": None}
        queue_utils.publish(bvid_uid, msg)
        logger.info(f"[{bvid_uid}] 全流程完成")

    except Exception as e:
        logger.error(f"[{bvid_uid}] Agent 任务失败: {e}", exc_info=True)
        # 失败了也要推送 phase="done"，否则前端 SSE 永远不关闭
        msg = {"bvid_uid": bvid_uid, "phase": "done", "message": f"任务失败: {str(e)[:100]}", "done": True, "error": str(e)}
        queue_utils.publish(bvid_uid, msg)

        # 任务执行失败，删除可能已写入一半的结果文件
        if output_path and os.path.exists(output_path):
            os.remove(output_path)
