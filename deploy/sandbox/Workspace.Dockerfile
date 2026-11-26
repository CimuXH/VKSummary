FROM vksummary/workspace:1

# 直接访问 HTTPS 镜像。调用方也可以给 pip/apk 指定其他公网源。
RUN set -eu; branch="v$(cut -d. -f1,2 /etc/alpine-release)"; \
    printf 'https://mirrors.aliyun.com/alpine/%s/main\nhttps://mirrors.aliyun.com/alpine/%s/community\n' "$branch" "$branch" > /etc/apk/repositories

ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
    PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/workspace/lib
CMD ["sleep", "infinity"]
