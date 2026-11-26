#!/bin/sh
# 仅管理本项目的 bridge 和 nftables 表，不清空宿主机防火墙。
set -eu
name=vksummary-workspaces
owner=io.vksummary.network
if docker network inspect "$name" >/dev/null 2>&1; then
    config=$(docker network inspect -f '{{index .Labels "io.vksummary.network"}} {{index .Options "com.docker.network.bridge.name"}} {{index .Options "com.docker.network.bridge.enable_icc"}} {{.Internal}} {{.EnableIPv6}}' "$name")
    [ "$config" = 'workspace vkws0 false false false' ] || { echo "Unexpected network: $name" >&2; exit 1; }
else
    docker network create --driver bridge --ipv6=false --label "$owner=workspace" \
        --opt com.docker.network.bridge.name=vkws0 --opt com.docker.network.bridge.enable_icc=false "$name"
fi
# 允许公网 IPv4 出站，不让工作区访问主机服务、其他私网和云元数据。
# nft 在一个事务中提交；重复执行只替换这个专用表中的规则。
nft -f - <<'RULES'
table inet vksummary_workspace
flush table inet vksummary_workspace
table inet vksummary_workspace {
    chain input {
        type filter hook input priority -10; policy accept;
        iifname "vkws0" drop
    }
    chain forward {
        type filter hook forward priority -10; policy accept;
        iifname "vkws0" meta nfproto ipv6 drop
        iifname "vkws0" ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 240.0.0.0/4 } drop
    }
}
RULES
