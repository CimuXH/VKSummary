#!/bin/sh
# 在服务器上运行。依赖、配置、状态和服务名均为 VKSummary 专用。
set -eu
cd "$(dirname "$0")"
dest=/opt/vksummary-sandbox
command -v nft >/dev/null || { echo '需要 nftables 来设置工作区网桥的出站边界。' >&2; exit 1; }
install -d -m 755 "$dest"
if ! docker image inspect vksummary/workspace:1 >/dev/null 2>&1; then
    docker pull public.ecr.aws/docker/library/python:3.12-alpine
    docker tag public.ecr.aws/docker/library/python:3.12-alpine vksummary/workspace:1
fi
# 构建上下文只放 Dockerfile，避免把凭据或其他项目文件发送给 Docker。
builddir=$(mktemp -d)
trap 'rm -f "$builddir/Dockerfile"; rmdir "$builddir"' EXIT
install -m 644 Workspace.Dockerfile "$builddir/Dockerfile"
docker build -t vksummary/workspace:3 "$builddir"
python3 -m pip install --disable-pip-version-check --no-cache-dir --target "$dest/deps" \
    'fastapi==0.115.12' 'uvicorn==0.34.3' 'pydantic==2.11.5'
if [ ! -s "$dest/runner.token" ]; then
    (umask 077; python3 -c 'import secrets; print(secrets.token_hex(32))' > "$dest/runner.token")
fi
install -m 644 runner.py network.sh "$dest/"
install -m 644 vksummary-network.service vksummary-sandbox.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable vksummary-sandbox.service
systemctl restart vksummary-network.service
systemctl restart vksummary-sandbox.service

# 从 v2 升级时让正在使用的旧工作区自然过期，避免丢失用户文件。
legacy=/etc/systemd/system/vksummary-repos.service
if [ -f "$legacy" ]; then
    active=$(docker ps -q --filter label=io.vksummary.workspace --filter ancestor=vksummary/workspace:2)
    if [ -z "$active" ]; then
        systemctl disable --now vksummary-repos.service
        rm -f "$legacy" "$dest/packages.nginx.conf"
        systemctl daemon-reload
    else
        echo '旧工作区仍在使用；待其过期后再次运行 install.sh 可移除旧代理。'
    fi
fi
