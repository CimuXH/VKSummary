"""Chat 只通过 HTTP 访问 Runner；容器选择及 Docker 参数均由 Runner 决定。"""

import os
from pathlib import Path
from uuid import uuid4

import httpx


def sandbox_exec(argv: list[str], stdin: str = "", *, thread_id: str) -> dict:
    url = os.getenv("SANDBOX_RUNNER_URL", "").rstrip("/")
    if not url:
        return {"error": "尚未配置沙箱 Runner 地址。"}
    token_file = Path(__file__).resolve().parents[3] / ".secrets" / "runner.token"
    token = os.getenv("SANDBOX_RUNNER_TOKEN") or (token_file.read_text().strip() if token_file.is_file() else "")
    if not token:
        return {"error": "缺少沙箱 Runner 凭据。"}
    execution_id = uuid4().hex
    try:
        # 断线时不自动重发有副作用的命令；SSH 隧道和本地 HTTP 都无需系统代理。
        with httpx.Client(trust_env=False, timeout=httpx.Timeout(125, connect=5)) as client:
            response = client.post(f"{url}/exec", headers={"Authorization": f"Bearer {token}"},
                                   json={"execution_id": execution_id, "thread_id": thread_id,
                                         "argv": argv, "stdin": stdin})
        if response.is_success:
            return response.json()
        detail = response.json().get("detail")
        return {"error": detail if isinstance(detail, str) else "Runner 拒绝了请求。", "execution_id": execution_id}
    except (httpx.HTTPError, ValueError):
        return {"error": "未获得执行结果，请检查 Runner 连接；请先确认工作区状态再重试。",
                "execution_id": execution_id}
