"""VKSummary 单 worker Runner。只有这里能调用宿主机 Docker。"""

import asyncio
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID, uuid4
import os

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field


IMAGE = "vksummary/workspace:3"
OWNER = "io.vksummary.workspace"
TTL = 30 * 60
gate = asyncio.Lock()  # 小规格共享服务器：同一时间只执行一条命令。


async def docker(*args, stdin="", timeout=15):
    """持续排空两条输出流，各只保留前 8 KiB，防止大输出撑满 Runner 内存。"""
    proc = await asyncio.create_subprocess_exec(
        "/usr/bin/docker", *args, stdin=-1, stdout=-1, stderr=-1,
    )

    async def read(stream):
        data = bytearray()
        total = 0
        while chunk := await stream.read(32768):
            total += len(chunk)
            data.extend(chunk[:8192 - len(data)])
        return data.decode(errors="replace"), total > len(data)

    async def feed():
        try:
            proc.stdin.write(stdin.encode())
            await proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            proc.stdin.close()

    try:
        async with asyncio.timeout(timeout):
            stdout, stderr, _, code = await asyncio.gather(
                read(proc.stdout), read(proc.stderr), feed(), proc.wait(),
            )
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.communicate()
    return {"stdout": stdout[0], "stderr": stderr[0], "exit_code": code,
            "truncated": stdout[1] or stderr[1]}


async def owned_container(sid):
    # 用标签找到本代容器，再按不可变的容器 ID 操作；不按用户参数或名字删除。
    result = await docker("ps", "-aq", "--no-trunc", "--filter", f"label={OWNER}={sid}")
    if result["exit_code"]:
        raise HTTPException(503, "无法查询工作区状态")
    ids = result["stdout"].split()
    if len(ids) > 1:
        raise HTTPException(409, "工作区标签冲突")
    return ids[0] if ids else None


async def retire(sid):
    cid = await owned_container(sid)
    if cid and (await docker("rm", "-f", cid))["exit_code"]:
        raise HTTPException(503, "工作区回收失败，将重试")
    app.state.db.execute("DELETE FROM sandbox_sessions WHERE sandbox_id=?", (sid,))


async def expire():
    rows = app.state.db.execute("SELECT sandbox_id FROM sandbox_sessions WHERE last_used <= ?",
                                (time.time() - TTL,)).fetchall()
    for (sid,) in rows:
        await retire(sid)


async def sweep():
    import logging
    while True:
        await asyncio.sleep(60)
        try:
            async with gate:
                await expire()
        except Exception:
            logging.exception("VKSummary 工作区回收失败")


@asynccontextmanager
async def lifespan(app):
    app.state.token = (Path(os.environ["CREDENTIALS_DIRECTORY"]) / "runner-token").read_text().strip()
    if not app.state.token:
        raise RuntimeError("缺少 Runner 凭据")
    db = app.state.db = sqlite3.connect(Path(os.environ["STATE_DIRECTORY"]) / "sessions.db",
                                        isolation_level=None)
    db.execute("""CREATE TABLE IF NOT EXISTS sandbox_sessions (
        thread_id TEXT PRIMARY KEY, sandbox_id TEXT UNIQUE NOT NULL,
        container_id TEXT, last_used REAL NOT NULL)""")
    cleaner = asyncio.create_task(sweep())
    try:
        yield
    finally:
        cleaner.cancel()
        await asyncio.gather(cleaner, return_exceptions=True)
        db.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid")
    execution_id: UUID
    thread_id: str = Field(pattern=r"^(default|[a-f0-9]{32})$")
    argv: list[str] = Field(min_length=1, max_length=128)
    stdin: str = Field(default="", max_length=65536)


async def workspace(thread_id):
    db = app.state.db
    row = db.execute("SELECT sandbox_id, container_id FROM sandbox_sessions WHERE thread_id=?",
                     (thread_id,)).fetchone()
    if row:
        sid, cid = row
        if cid and await owned_container(sid) == cid:
            status = await docker("inspect", "-f", "{{.State.Running}}", cid)
            if status["exit_code"] == 0 and status["stdout"].strip() == "true":
                return sid, cid, False
        await retire(sid)
    if db.execute("SELECT count(*) FROM sandbox_sessions").fetchone()[0] >= 2:
        raise HTTPException(429, "两个工作区均在使用，请稍后再试")
    sid = uuid4().hex
    # 先落库，再创建带标签的容器；启动中断也能由下一次请求或定时回收处理。
    db.execute("INSERT INTO sandbox_sessions VALUES (?, ?, NULL, ?)", (thread_id, sid, time.time()))
    result = await docker("run", "-d", "--pull=never", "--name", f"vksummary-ws-{sid}",
                          "--label", f"{OWNER}={sid}", "--network=vksummary-workspaces", "--read-only",
                          "--dns=223.5.5.5", "--dns=1.1.1.1",
                          "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=65534:65534",
                          "--memory=96m", "--memory-swap=96m", "--cpus=0.35", "--pids-limit=48",
                          "--shm-size=4m", "--log-driver=none", "--init",
                          "--tmpfs", "/workspace:rw,nosuid,nodev,size=16m,uid=65534,gid=65534,mode=700",
                          "--tmpfs", "/tmp:rw,nosuid,nodev,size=8m,mode=1777",
                          "-w", "/workspace", IMAGE)
    if result["exit_code"]:
        await retire(sid)
        raise HTTPException(503, "工作区创建失败，请检查 Runner 镜像及资源")
    cid = result["stdout"].strip()
    db.execute("UPDATE sandbox_sessions SET container_id=? WHERE sandbox_id=?", (cid, sid))
    return sid, cid, True


@app.post("/exec")
async def execute(command: Command, authorization: str = Header(default="")):
    if not secrets.compare_digest(authorization.encode(), ("Bearer " + app.state.token).encode()):
        raise HTTPException(401, "Runner 认证失败")
    if (not command.argv[0] or any("\x00" in arg for arg in command.argv)
            or sum(map(len, command.argv)) > 32768):
        raise HTTPException(422, "无效的命令参数")
    try:
        await asyncio.wait_for(gate.acquire(), timeout=5)
    except TimeoutError:
        raise HTTPException(429, "Runner 正忙，此命令尚未执行")
    try:
        await expire()
        sid, cid, created = await workspace(command.thread_id)
        try:
            # 首次下载要拉取仓库索引，包管理命令有独立时限。
            program = Path(command.argv[0]).name
            packages = program in {"apk", "pip", "pip3"} or (
                program in {"python", "python3"} and command.argv[1:3] == ["-m", "pip"]
            )
            result = await docker("exec", "-i", "--", cid, *command.argv, stdin=command.stdin,
                                  timeout=90 if packages else 20)
        except TimeoutError:
            # 停掉 docker 客户端不能保证容器内进程退出，超时后回收这一代工作区。
            await retire(sid)
            raise HTTPException(408, "命令超时，当前工作区已回收")
        app.state.db.execute("UPDATE sandbox_sessions SET last_used=? WHERE sandbox_id=?", (time.time(), sid))
        return {**result, "execution_id": command.execution_id, "sandbox_id": sid, "created": created}
    finally:
        gate.release()
