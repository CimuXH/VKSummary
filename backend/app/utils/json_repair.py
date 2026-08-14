"""LLM 输出 JSON 的兜底解析与修复工具。

解析级别（逐级尝试，成功即返回）：
- Level 0: 标准 JSON 直接解析
- Level 1: 剥除 ```json 代码围栏，提取第一个 { 到最后一个 } 的子串
          （处理 JSON 前后的解释文字）
- Level 2: json5 宽容解析（裸 key、注释、单引号、尾随逗号等 JS 风格）
- Level 3: 无损修复（不改变字符串内容）：
    - 单引号字符串 → 双引号
    - Python 风格 True/False/None/NaN/Infinity → JSON 字面量
    - 尾随逗号 {...,} / [...,]
    - 字符串内裸换行 / 制表符 → 转义
- Level 4: 破坏性兜底：字符串内未转义双引号 → 中文引号「」
          （会改动字符串内容，仅在前面全部失败时使用）
"""
import json
import math
import re
import logging

logger = logging.getLogger(__name__)

try:
    import json5
except ImportError:
    json5 = None

# Python 风格字面量 → JSON 字面量
_KEYWORD_MAP = {
    "True": "true",
    "False": "false",
    "None": "null",
    "NaN": "null",
    "Infinity": "null",
}

# 字符串内需要转义的裸控制字符
_CONTROL_CHARS = {"\n": "\\n", "\r": "\\r", "\t": "\\t"}


def _sanitize(obj):
    """递归把 NaN / Infinity 浮点转为 None，避免写文件时产出非标准 JSON。"""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    return obj


def _ensure_dict(parsed) -> dict:
    """校验解析结果是 dict，否则抛 ValueError 进入下一级修复。"""
    if not isinstance(parsed, dict):
        raise ValueError(f"解析结果不是 JSON 对象: {str(parsed)[:200]}")
    return _sanitize(parsed)


def _strip_and_extract(text: str) -> str:
    """剥除代码围栏，并提取第一个 { 到最后一个 } 的子串。"""
    text = text.lstrip("﻿").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        text = text[start : end + 1]
    return text.strip()


def _is_keyword_at(text: str, i: int, kw: str) -> bool:
    """位置 i 处是否为独立关键字（前后都不是标识符字符）。"""
    j = i + len(kw)
    prev_ok = i == 0 or not (text[i - 1].isalnum() or text[i - 1] == "_")
    next_ok = j >= len(text) or not (text[j].isalnum() or text[j] == "_")
    return prev_ok and next_ok


def _lossless_repair(text: str) -> str:
    """引号感知扫描，无损修复：单引号、Python 字面量、尾随逗号、字符串内换行。

    只改 JSON 语法层面的内容，字符串内部字符原样保留。
    字符串闭合采用向前看启发式：引号后紧跟 , : } ] 才是真的闭合，
    否则视为字符串内部引号，原样保留，留给 Level 4 兜底。
    """
    out = []
    i, n = 0, len(text)
    in_string = False
    quote = None

    while i < n:
        ch = text[i]

        if in_string:
            if ch == "\\":
                out.append(ch)          # 保留已有转义序列
                i += 1
                if i < n:
                    out.append(text[i])
                    i += 1
                continue
            if ch == quote:
                remaining = text[i + 1 :].lstrip()
                if not (remaining and remaining[0] in ",:}]"):
                    # 字符串内部引号（如 他说"你好"），原样保留
                    out.append(ch)
                    i += 1
                    continue
                out.append('"')         # 字符串结束，统一写双引号
                in_string = False
                quote = None
                i += 1
                continue
            if ch in _CONTROL_CHARS:
                out.append(_CONTROL_CHARS[ch])
                i += 1
                continue
            out.append(ch)
            i += 1
            continue

        # 字符串外
        if ch in "\"'":
            in_string = True
            quote = ch
            out.append('"')             # 字符串开始，统一写双引号
            i += 1
            continue

        # Python 风格关键字 → JSON 字面量（带词边界检查）
        for kw, repl in _KEYWORD_MAP.items():
            if text.startswith(kw, i) and _is_keyword_at(text, i, kw):
                out.append(repl)
                i += len(kw)
                break
        else:
            # 尾随逗号：逗号(可带空白)后紧跟 } 或 ]
            if ch == ",":
                j = i + 1
                while j < n and text[j] in " \t\r\n":
                    j += 1
                if j < n and text[j] in "}]":
                    i = j
                    continue
            out.append(ch)
            i += 1

    return "".join(out)


def _fix_unescaped_quotes_in_strings(text: str) -> str:
    """修复 JSON 字符串值内部未转义的双引号，替换为中文引号「」。

    扫描整个 JSON 文本，当检测到字符串值内部的 " 时（非结尾引号），替换为中文引号。
    """
    result = []
    i = 0
    in_string = False
    escape_next = False

    while i < len(text):
        ch = text[i]

        if escape_next:
            result.append(ch)
            escape_next = False
            i += 1
            continue

        if ch == '\\':
            result.append(ch)
            escape_next = True
            i += 1
            continue

        if in_string:
            if ch == '"':
                # 向前看：紧跟着的是不是 JSON 结构字符
                remaining = text[i+1:].lstrip()
                if remaining and remaining[0] in ',:]}':
                    result.append(ch)
                    in_string = False
                else:
                    # 字符串内部的引号 → 替换为中文引号
                    prev = text[i-1] if i > 0 else ''
                    if prev.isalnum() or (prev.isascii() and prev.isprintable() and prev not in ' [{('):
                        result.append('」')
                    else:
                        result.append('「')
            else:
                result.append(ch)
        else:
            result.append(ch)
            if ch == '"':
                # 判断是否在值位置（非 key 位置）
                before = text[:i].rstrip()
                if before and before[-1] in ':,[{':
                    in_string = True

        i += 1

    return ''.join(result)


def repair_and_parse_json(raw) -> dict:
    """兜底修复 LLM 输出的 JSON，逐级尝试解析，详见模块 docstring。"""
    if raw is None or not str(raw).strip():
        raise ValueError("LLM 输出为空")

    text = str(raw).strip()

    # Level 0: 标准 JSON 直接解析
    try:
        return _ensure_dict(json.loads(text))
    except (json.JSONDecodeError, ValueError):
        pass

    # Level 1: 剥围栏 + 提取最外层 {...}
    text = _strip_and_extract(text)
    try:
        return _ensure_dict(json.loads(text))
    except (json.JSONDecodeError, ValueError):
        pass

    # Level 2: json5 宽容解析（裸 key / 注释 / 单引号 / 尾随逗号等）
    if json5 is not None:
        try:
            return _ensure_dict(json5.loads(text))
        except Exception:
            pass

    # Level 3: 无损修复
    repaired = _lossless_repair(text)
    try:
        return _ensure_dict(json.loads(repaired))
    except (json.JSONDecodeError, ValueError):
        pass
    if json5 is not None:
        try:
            return _ensure_dict(json5.loads(repaired))
        except Exception:
            pass

    # Level 4: 破坏性兜底——字符串内未转义双引号 → 中文引号
    repaired = _fix_unescaped_quotes_in_strings(repaired)
    try:
        return _ensure_dict(json.loads(repaired))
    except (json.JSONDecodeError, ValueError):
        pass

    logger.error(f"JSON 修复失败，原始输出前 500 字符: {text[:500]}")
    raise ValueError(f"无法解析 LLM 输出的 JSON，原始内容: {str(raw)[:500]}")
