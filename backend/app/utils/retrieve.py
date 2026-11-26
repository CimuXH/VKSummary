# -*- coding: utf-8 -*-
"""字幕检索工具：分块 + Chroma/sqlite FTS5 混合索引 + 增量更新。"""
import jieba

import json
import re
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from uuid import uuid4

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

_SEARCH_RUN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]+|[a-z0-9]+")
_CHUNK_COLUMNS = "id, bvid_uid, bvid, page, part, source_url, content"


def _search_groups(text: str):
    """把连续汉字切成相邻双字，英文和数字保留为词。"""
    for part in _SEARCH_RUN.findall(text.lower()):
        if part.isascii():
            yield [part]
        elif len(part) >= 2:
            yield [part[i:i + 2] for i in range(len(part) - 1)]


def _search_text(content: str) -> str:
    # unicode61 会索引这个私用字符，防止完整短语跨标点或空格匹配。
    return " \ue000 ".join(" ".join(group) for group in _search_groups(content))


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

def _create_chunks_fts(conn: sqlite3.Connection, table: str):
    conn.execute(
        f"""
        CREATE VIRTUAL TABLE {table} USING fts5(
            id UNINDEXED,
            bvid_uid UNINDEXED,
            bvid UNINDEXED,
            page UNINDEXED,
            part UNINDEXED,
            source_url UNINDEXED,
            content UNINDEXED,
            search_text,
            tokenize='unicode61'
        )
        """
    )


def _insert_chunks(conn: sqlite3.Connection, rows, table: str = "chunks_fts"):
    conn.executemany(
        f"INSERT INTO {table} ({_CHUNK_COLUMNS}, search_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ((*row, _search_text(row[-1] or "")) for row in rows),
    )


def _ensure_chunks_fts(conn: sqlite3.Connection):
    if conn.execute("SELECT 1 FROM pragma_table_info('chunks_fts') WHERE name = 'search_text'").fetchone():
        return

    # 拿到写锁后重新检查，避免两个连接同时迁移同一个旧表。
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        columns = {row[1] for row in conn.execute("PRAGMA table_info(chunks_fts)")}
        if not columns:
            _create_chunks_fts(conn, "chunks_fts")
        elif "search_text" not in columns:
            _create_chunks_fts(conn, "chunks_fts_new")
            rows = conn.execute(f"SELECT {_CHUNK_COLUMNS} FROM chunks_fts")
            _insert_chunks(conn, rows, "chunks_fts_new")
            old_count = conn.execute("SELECT count(*) FROM chunks_fts").fetchone()[0]
            new_count = conn.execute("SELECT count(*) FROM chunks_fts_new").fetchone()[0]
            if old_count != new_count:
                raise RuntimeError("字幕索引迁移后的片段数不一致")
            conn.execute("DROP TABLE chunks_fts")
            conn.execute("ALTER TABLE chunks_fts_new RENAME TO chunks_fts")


def init_sqlite(conn: sqlite3.Connection):
    """初始化字幕关键词索引和对话历史表。"""
    _ensure_chunks_fts(conn)
    _ensure_chat_tables(conn)


# 从 chroma 和 sqlite的fts5 中删除该任务字幕内容
def delete_hybrid_index_by_bvid_uid(bvid_uid: str):
    """删除某个任务在 Chroma 和 FTS5 里的索引。"""
    try:
        get_collection().delete(where={"bvid_uid": bvid_uid})
        logger.info(f"- {bvid_uid}: 的内容已经从Chroma中删除")
    except Exception:
        logger.error(f"- {bvid_uid}: 的内容从Chroma中删除失败！", exc_info=True)

    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(DB_PATH)) as conn:
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
    with closing(sqlite3.connect(DB_PATH)) as conn:
        init_sqlite(conn)
        _insert_chunks(
            conn,
            ((c["id"], c["bvid_uid"], c["bvid"], c["page"], c["part"],
              c["source_url"], c["content"]) for c in chunks),
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
    """先查完整短语，再用单个索引词补足候选。"""
    _STOPWORDS = {"的", "了", "是", "在", "有", "和", "就", "不", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "那", "什么", "怎么", "如何", "为什么", "哪些", "哪个", "吗", "呢", "啊", "吧", "与", "及", "或", "等", "可以", "应该", "请问", "一下"}
    words = [piece.strip() for piece in jieba.cut(question)]
    groups = [
        group for word in words if len(word) > 1 and word not in _STOPWORDS
        for group in _search_groups(word)
    ]

    # 保留短查询中的完整术语，例如 jieba 可能把「缓存雪崩」拆成两词。
    short = question.strip(" \t\r\n?!？！。")
    whole = []
    if 2 <= len(short) <= 12 and short not in _STOPWORDS and _SEARCH_RUN.fullmatch(short.lower()):
        whole = next(_search_groups(short), [])
    phrases = [" ".join(whole)] if len(whole) > 1 else [
        " ".join(group) for group in groups if len(group) > 1
    ]
    terms = [token for group in groups for token in group]
    if len(whole) == 1 or not _STOPWORDS.intersection(words):
        terms.extend(whole)
    if top_k <= 0 or not terms:
        return []

    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    rows = {}
    with closing(sqlite3.connect(DB_PATH)) as conn:
        init_sqlite(conn)
        try:
            for candidates in (phrases, terms):
                if not candidates:
                    continue
                match_expr = " OR ".join(f'"{term}"' for term in dict.fromkeys(candidates))
                for row in conn.execute(
                    f"""
                    SELECT {_CHUNK_COLUMNS}, bm25(chunks_fts) AS score
                    FROM chunks_fts
                    WHERE chunks_fts MATCH ?
                    ORDER BY score, rowid
                    LIMIT ?
                    """,
                    (match_expr, top_k),
                ):
                    rows.setdefault(row[0], row)
                if len(rows) >= top_k:
                    break
        except sqlite3.OperationalError:
            logger.warning("字幕关键词检索失败", exc_info=True)
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
        for r in list(rows.values())[:top_k]
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
def _ensure_chat_tables(conn: sqlite3.Connection):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_summary_archive (
            thread_id TEXT PRIMARY KEY, through_id INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_summaries (
            thread_id TEXT NOT NULL, first_id INTEGER NOT NULL,
            last_id INTEGER NOT NULL, content TEXT NOT NULL,
            PRIMARY KEY (thread_id, first_id)
        )
    """)
    if conn.execute("SELECT 1 FROM pragma_table_info('chat_messages') WHERE name = 'thread_id'").fetchone():
        return

    # 迁移和新表创建用同一个事务；旧消息通过列默认值归入「默认对话」。
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY NOT NULL)")
        conn.execute("INSERT OR IGNORE INTO chat_threads (id) VALUES ('default')")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                thread_id TEXT NOT NULL DEFAULT 'default'
            )
            """
        )
        # 获取写锁后复查，防止两个首次请求重复加列。
        columns = {row[1] for row in conn.execute("PRAGMA table_info(chat_messages)")}
        if "thread_id" not in columns:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN thread_id TEXT NOT NULL DEFAULT 'default'")
        conn.execute("CREATE INDEX IF NOT EXISTS chat_messages_thread ON chat_messages (thread_id, id)")


@contextmanager
def _chat_db():
    """打开聊天数据库。读取会话时无需打开字幕索引。"""
    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(DB_PATH)) as conn:
        _ensure_chat_tables(conn)
        yield conn


def list_chat_threads() -> list[dict]:
    with _chat_db() as conn:
        return [{"id": row[0]} for row in conn.execute("SELECT id FROM chat_threads ORDER BY rowid")]


def create_chat_thread() -> dict:
    thread_id = uuid4().hex
    with _chat_db() as conn, conn:
        conn.execute("INSERT INTO chat_threads (id) VALUES (?)", (thread_id,))
    return {"id": thread_id}


def chat_thread_exists(thread_id: str) -> bool:
    with _chat_db() as conn:
        return conn.execute("SELECT 1 FROM chat_threads WHERE id = ?", (thread_id,)).fetchone() is not None


def save_chat_messages(user_content: str, assistant_content: str, *, thread_id: str = "default"):
    """把一轮完整的问答一起保存到同一会话。"""
    with _chat_db() as conn, conn:
        conn.executemany(
            "INSERT INTO chat_messages (thread_id, role, content) VALUES (?, ?, ?)",
            [(thread_id, "user", user_content), (thread_id, "assistant", assistant_content)],
        )


def get_recent_messages(limit: int = 10, *, thread_id: str = "default") -> list[dict]:
    """按正序返回指定会话的近期消息。limit 只限制读取条数。"""
    with _chat_db() as conn:
        rows = conn.execute(
            "SELECT role, content FROM chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?",
            (thread_id, limit),
        ).fetchall()
    return [{"role": r[0], "content": r[1]} for r in reversed(rows)]


def load_chat_context(thread_id: str, input_budget: int):
    """同一快照读取窗口内的摘要，以及尚未被任何摘要覆盖的原文。"""
    with _chat_db() as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("BEGIN")
        summaries = []
        chars = 0
        for summary in conn.execute(
            "SELECT first_id, last_id, content FROM chat_summaries WHERE thread_id = ? AND first_id > "
            "COALESCE((SELECT through_id FROM chat_summary_archive WHERE thread_id = ?), 0) "
            "ORDER BY first_id DESC", (thread_id, thread_id),
        ):
            summaries.append(dict(summary))
            chars += len(summary["content"]) + 1
            if chars >= 3 * input_budget:  # 与本地估算一致，更多的摘要肯定放不下。
                break
        rows = conn.execute(
            "SELECT id, role, content FROM chat_messages WHERE thread_id = ? AND id > COALESCE("
            " (SELECT last_id FROM chat_summaries WHERE thread_id = ? ORDER BY first_id DESC LIMIT 1), 0)"
            " ORDER BY id", (thread_id, thread_id),
        ).fetchall()
    return summaries, list(map(dict, rows))


def archive_chat_summaries(thread_id: str, through_id: int):
    # 只移动默认加载的边界。摘要和原文都保留，并发请求也不会把边界往回移。
    with _chat_db() as conn, conn:
        conn.execute(
            "INSERT INTO chat_summary_archive (thread_id, through_id) VALUES (?, ?) "
            "ON CONFLICT(thread_id) DO UPDATE SET through_id = max(through_id, excluded.through_id)",
            (thread_id, through_id),
        )


def save_chat_summary(thread_id: str, first_id: int, last_id: int, content: str) -> bool:
    # 同会话并发压缩时，只有一个请求能写入这段原文；另一个重新读取已保存的结果。
    with _chat_db() as conn, conn:
        return conn.execute(
            "INSERT INTO chat_summaries (thread_id, first_id, last_id, content) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(thread_id, first_id) DO NOTHING",
            (thread_id, first_id, last_id, content),
        ).rowcount == 1


def read_chat_messages(ids: list[int], offset: int, *, thread_id: str) -> dict:
    # 由后端限定会话；超长原文可从 next_offset 继续读，避免一次检索填满窗口。
    marks = ",".join("?" for _ in ids)
    with _chat_db() as conn:
        rows = conn.execute(
            f"SELECT id, role, substr(content, ?, 2000), length(content) FROM chat_messages "
            f"WHERE thread_id = ? AND id IN ({marks}) ORDER BY id",
            (offset + 1, thread_id, *ids),
        ).fetchall()
    return {"messages": [{"id": mid, "role": role, "content": part, "offset": offset,
                          "next_offset": offset + len(part) if offset + len(part) < size else None}
                         for mid, role, part, size in rows]}
