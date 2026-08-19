# -*- coding: utf-8 -*-
"""字幕检索工具：分块 + Chroma/sqlite FTS5 混合索引 + 增量更新。"""
import jieba

import json
import re
import sqlite3
from pathlib import Path

from chromadb import PersistentClient
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

from langchain_text_splitters import RecursiveCharacterTextSplitter
import logging

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent.parent          # backend/
SUBTITLE_DIR = BASE_DIR / "data" / "subtitles"
CHAT_DIR = BASE_DIR / "data" / "chat_index"
CHROMA_DIR = CHAT_DIR / "chroma"
DB_PATH = CHAT_DIR / "chat.db"
MODEL_PATH = Path(__file__).parent.parent / "embeding_model" / "BAAI--bge-small-zh-v1.5"

_collection = None


# 获取集合对象（相当于chroma的表对象，操作表）
def get_collection():
    """获取全局 Chroma Collection。"""
    global _collection
    if _collection is None:
        CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        client = PersistentClient(path=str(CHROMA_DIR))
        # 把本地模型封装成chroma能直接调用的接口
        embedding_fn = SentenceTransformerEmbeddingFunction(model_name=str(MODEL_PATH))
        # 创建一个集合对象（集合相当于是一个表）
        _collection = client.get_or_create_collection(
            name="subtitle_chunks",
            embedding_function=embedding_fn,
        )
    return _collection


# 把每个文件内容进行分块
def chunk_subtitle_file(path: Path) -> list[dict]:
    """把一个字幕文件切成小段。"""
    bvid_uid = path.stem
    bvid = bvid_uid.split("_")[0]
    source_url = f"https://www.bilibili.com/video/{bvid}"
    text = path.read_text(encoding="utf-8")

    chunks = []
    index = 0

    # 分割器
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=100,
        separators=["\n\n", "\n", "。", "！", "？", "，", " ", ""]
    )

    # 按分P头切分，例如：### part: xxx, page: 1, cid: xxx
    parts = re.split(r"(?m)^###\s*part:\s*(.*)$", text)
    if len(parts) == 1:
        parts = ["", path.stem, text]

    # 遍历每一个p，把每个p内部进行分割
    for i in range(1, len(parts), 2):
        header = parts[i].strip()
        body = parts[i + 1].strip()
        if not body:
            continue

        page_match = re.search(r"page:\s*(\d+)", header)
        page = int(page_match.group(1)) if page_match else None
        part = re.sub(r",\s*page:.*$", "", header).strip()

        # 使用分块器进行分块
        chunk_texts = splitter.split_text(body)
        for chunk_text in chunk_texts:
            chunks.append({
                "id": f"{bvid_uid}_{index:04d}",
                "bvid_uid": bvid_uid,
                "bvid": bvid,
                "page": page,
                "part": part,
                "content": chunk_text,
                "source_url": source_url,
                "chunk_index": index,
            })
            index += 1
            
    logger.info(f"- {bvid_uid}: 的字幕内容已经分块好了")
    return chunks

# 初始化创建sqlite的fts5表和对话历史表
def init_sqlite(conn: sqlite3.Connection):
    """初始化 FTS5 表和对话历史表。"""
    conn.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            id UNINDEXED,
            bvid_uid UNINDEXED,
            bvid UNINDEXED,
            page UNINDEXED,
            part UNINDEXED,
            source_url UNINDEXED,
            content,
            tokenize='trigram'
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.commit()


# 从 chroma 和 sqlite的fts5 中删除该任务字幕内容
def delete_hybrid_index_by_bvid_uid(bvid_uid: str):
    """删除某个任务在 Chroma 和 FTS5 里的索引。"""
    try:
        get_collection().delete(where={"bvid_uid": bvid_uid})
        logger.info(f"- {bvid_uid}: 的内容已经从Chroma中删除")
    except Exception:
        logger.error(f"- {bvid_uid}: 的内容从Chroma中删除失败！", exc_info=True)

    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        init_sqlite(conn)
        conn.execute("DELETE FROM chunks_fts WHERE bvid_uid = ?", (bvid_uid,))
        conn.commit()


# 把这个字幕内容加入到 chroma 和 sqlite的fts5 中
def build_hybrid_index_for_file(path: Path) -> int:
    """为一个字幕文件建立/重建混合索引，返回 chunk 数。"""
    chunks = chunk_subtitle_file(path)
    bvid_uid = path.stem

    # 先删旧索引，再写新索引
    delete_hybrid_index_by_bvid_uid(bvid_uid)
    if not chunks:
        return 0

    # 写入 Chroma
    get_collection().add(
        ids=[c["id"] for c in chunks],
        documents=[c["content"] for c in chunks],
        metadatas=[
            {
                "bvid_uid": c["bvid_uid"],
                "bvid": c["bvid"],
                "page": c["page"] or 0,
                "part": c["part"] or "",
                "source_url": c["source_url"],
            }
            for c in chunks
        ],
    )

    # 写入 SQLite FTS5
    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        init_sqlite(conn)
        conn.executemany(
            """
            INSERT INTO chunks_fts
                (id, bvid_uid, bvid, page, part, source_url, content)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    c["id"],
                    c["bvid_uid"],
                    c["bvid"],
                    c["page"],
                    c["part"],
                    c["source_url"],
                    c["content"],
                )
                for c in chunks
            ],
        )
        conn.commit()

    return len(chunks)



# 获取chroma的检索结果
def chroma_search(question: str, top_k: int = 10) -> list[dict]:
    """从 Chroma 检索语义相近的字幕片段。"""
    result = get_collection().query(
        query_texts=[question],
        n_results=top_k,
    )

    items = []
    ids = result["ids"][0]
    docs = result["documents"][0]
    metas = result["metadatas"][0]
    dists = result.get("distances", [None])[0]

    for i, chunk_id in enumerate(ids):
        meta = metas[i] or {}
        items.append({
            "id": chunk_id,
            "bvid_uid": meta.get("bvid_uid", ""),
            "bvid": meta.get("bvid", ""),
            "page": meta.get("page"),
            "part": meta.get("part", ""),
            "content": docs[i],
            "source_url": meta.get("source_url", ""),
            "score": dists[i] if dists and dists[i] is not None else 0,
        })
    return items


# 获取sqlite的fts5的bm25检索内容
def bm25_search(question: str, top_k: int = 10) -> list[dict]:
    """从 SQLite FTS5 检索关键词匹配的字幕片段。"""
    # 使用结巴中文分词，拆出关键词并去掉常见语气词
    _STOPWORDS = {"的", "了", "是", "在", "有", "和", "就", "不", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "那", "什么", "怎么", "如何", "为什么", "哪些", "哪个", "吗", "呢", "啊", "吧", "与", "及", "或", "等", "可以", "应该", "请问", "一下"}
    words = [
        w.strip()
        for w in jieba.cut(question)
        if w.strip() and len(w.strip()) > 1 and w.strip() not in _STOPWORDS
    ]
    terms = list(dict.fromkeys(words))
    if not terms:
        return []

    match_expr = " OR ".join(f'"{t}"' for t in terms)

    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        init_sqlite(conn)
        try:
            rows = conn.execute(
                """
                SELECT id, bvid_uid, bvid, page, part, source_url, content,
                       bm25(chunks_fts) AS bm25_score
                FROM chunks_fts
                WHERE chunks_fts MATCH ?
                ORDER BY bm25_score
                LIMIT ?
                """,
                (match_expr, top_k),
            ).fetchall()
        except sqlite3.OperationalError:
            return []

    return [
        {
            "id": r[0],
            "bvid_uid": r[1],
            "bvid": r[2],
            "page": r[3],
            "part": r[4],
            "content": r[6],
            "source_url": r[5],
            "score": r[7],
        }
        for r in rows
    ]


# 使用rrf倒数排名融合 获得索引结果
def hybrid_search(question: str, top_k: int = 5, chroma_weight: float = 0.7, bm25_weight: float = 0.3) -> list[dict]:
    """混合检索：Chroma + BM25 结果用 RRF 融合后返回。"""
    chroma_results = chroma_search(question, top_k * 2)
    bm25_results = bm25_search(question, top_k * 2)

    rrf_scores = {}
    result_map = {}

    for rank, item in enumerate(chroma_results):
        chunk_id = item["id"]
        rrf_scores[chunk_id] = rrf_scores.get(chunk_id, 0) + chroma_weight / (60 + rank)
        result_map[chunk_id] = item

    for rank, item in enumerate(bm25_results):
        chunk_id = item["id"]
        rrf_scores[chunk_id] = rrf_scores.get(chunk_id, 0) + bm25_weight / (60 + rank)
        result_map[chunk_id] = item

    ranked_ids = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)[:top_k]

    results = []
    for chunk_id, score in ranked_ids:
        item = dict(result_map[chunk_id])
        item["score"] = round(score, 4)
        results.append(item)

    return results

# **************************对话历史消息相关数据库存储********************************
# 保存一条对话消息
def save_chat_message(role: str, content: str):
    """保存一条对话消息。role 为 user 或 assistant。"""
    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        init_sqlite(conn)
        conn.execute(
            "INSERT INTO chat_messages (role, content) VALUES (?, ?)",
            (role, content),
        )
        conn.commit()


# 保存一轮问答，并只保留最近100条
def save_chat_messages(user_content: str, assistant_content: str, keep: int = 100):
    """保存用户问题和助手回答，并删除更早的历史，只保留最近 keep 条。"""
    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        init_sqlite(conn)
        conn.execute(
            "INSERT INTO chat_messages (role, content) VALUES (?, ?)",
            ("user", user_content),
        )
        conn.execute(
            "INSERT INTO chat_messages (role, content) VALUES (?, ?)",
            ("assistant", assistant_content),
        )
        conn.execute(
            """
            DELETE FROM chat_messages
            WHERE id NOT IN (
                SELECT id FROM chat_messages
                ORDER BY id DESC
                LIMIT ?
            )
            """,
            (keep,),
        )
        conn.commit()


# 获取最近对话历史
def get_recent_messages(limit: int = 10) -> list[dict]:
    """获取最近 limit 条对话，按时间正序返回。"""
    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        init_sqlite(conn)
        rows = conn.execute(
            "SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [{"role": r[0], "content": r[1]} for r in reversed(rows)]


# 清空全部对话历史
def clear_chat_messages():
    """清空对话历史表。"""
    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        init_sqlite(conn)
        conn.execute("DELETE FROM chat_messages")
        conn.commit()
