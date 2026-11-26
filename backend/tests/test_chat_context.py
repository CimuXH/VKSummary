"""双水位回归测试，使用临时 SQLite 和固定长度的模拟摘要。"""

import asyncio
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from services import chat_service
from services.chat_context import ChatContext, ContextError, _cost, _json, _tokens
from utils import retrieve


class WatermarkTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        folder = Path(self.enterContext(TemporaryDirectory()))
        self.enterContext(patch.object(retrieve, "CHAT_DIR", folder))
        self.enterContext(patch.object(retrieve, "DB_PATH", folder / "chat.db"))
        self.enterContext(patch.dict(os.environ, CHAT_CONTEXT_WINDOW="32768", CHAT_MAX_OUTPUT_TOKENS="4096"))
        reply = SimpleNamespace(message=SimpleNamespace(content="s" * 2400), finish_reason="stop")
        self.summarize = AsyncMock(return_value=SimpleNamespace(choices=[reply]))
        self.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=self.summarize)))

    async def build(self, question="q"):
        active = [{"role": "system", "content": "s"}, {"role": "user", "content": question}]
        # 每次都新建 ChatContext，和正常的跨轮请求一样。
        return await ChatContext().build(self.client, "fixture", "default", active, [])

    def input_size(self, messages):
        return 8 + _tokens(_json([])) + sum(map(_cost, messages))

    async def test_long_recent_turns_then_short_followups(self):
        for size in (1700, 11450, 11450):
            retrieve.save_chat_messages("q", "a" * (3 * size))
        self.assertLessEqual(self.input_size(await self.build()), 14000)
        self.summarize.assert_awaited_once()
        for _ in range(6):
            retrieve.save_chat_messages("q", "a" * 2700)
            self.assertLess(self.input_size(await self.build()), 24000)
        self.summarize.assert_awaited_once()

    async def test_archived_notes_stay_out_on_next_request(self):
        for i in range(32):
            retrieve.save_chat_messages("q", "answer")
            retrieve.save_chat_summary("default", 2*i+1, 2*i+2, "s" * 2400)
        first = await self.build()
        self.assertLessEqual(self.input_size(first), 14000)
        self.assertGreater(len(first), 2)
        self.assertEqual(await self.build(), first)
        original = retrieve.read_chat_messages([1], 0, thread_id="default")
        self.assertEqual(original["messages"][0]["content"], "q")
        self.summarize.assert_not_awaited()

    async def test_required_input_alone_exceeds_target(self):
        retrieve.save_chat_messages("q", "a" * 30000)
        messages = await self.build("x" * 45000)
        self.assertEqual([m["role"] for m in messages], ["system", "user"])
        self.assertTrue(14000 < self.input_size(messages) <= 24000)
        with self.assertRaises(ContextError):
            await self.build("x" * 75000)

    async def test_exact_high_watermark(self):
        retrieve.save_chat_messages("q", "a" * 42000)
        # 使用同一估算器把候选输入精确推到 high-1、high 和 high+1。
        base = self.input_size(await self.build(""))
        for size in (23999, 24000, 24001):
            messages = await self.build("x" * (3 * (size - base)))
            if size <= 24000:
                self.assertEqual(self.input_size(messages), size)
                self.summarize.assert_not_awaited()
            else:
                self.assertLessEqual(self.input_size(messages), 14000)
                self.summarize.assert_awaited_once()

    async def check_followups(self, rounds, answer, min_gap):
        compressed = []
        for i in range(1, rounds + 1):
            before = self.summarize.await_count
            messages = await self.build()
            size = self.input_size(messages)
            if self.summarize.await_count > before:
                compressed.append(i)
                self.assertLessEqual(size, 14000)
            self.assertLessEqual(size, 24000)
            retrieve.save_chat_messages("q", answer)
        self.assertGreaterEqual(len(compressed), 2)
        self.assertTrue(all(b - a >= min_gap for a, b in zip(compressed, compressed[1:])), compressed)

    async def test_sixty_short_turns(self):
        await self.check_followups(60, "总结" * 300, 10)

    async def test_twenty_long_answers(self):
        await self.check_followups(20, "a" * 11700, 3)

    async def test_consecutive_large_questions(self):
        # 两条新问题各约 13000 tokens，单条就超过高低水位差。
        retrieve.save_chat_messages("q", "a" * 36000)
        question = "x" * 39000
        for _ in range(2):
            before = self.summarize.await_count
            self.assertLessEqual(self.input_size(await self.build(question)), 14000)
            self.assertGreater(self.summarize.await_count, before)
            retrieve.save_chat_messages(question, "ok")

    async def test_repeated_large_tool_results(self):
        for _ in range(6):
            retrieve.save_chat_messages("q", "a" * 7800)
        active = [{"role": "system", "content": "s"}, {"role": "user", "content": "q"}]
        context = ChatContext()
        messages = await context.build(self.client, "fixture", "default", active, [])
        start = len(messages)
        for i in range(4):
            call = {"id": str(i), "type": "function", "function": {"name": "sandbox_exec", "arguments": "{}"}}
            messages.append({"role": "assistant", "content": None, "tool_calls": [call]})
            messages.append({"role": "tool", "tool_call_id": str(i), "content": _json({
                "stdout": "中文" * 1200, "stderr": "🙂" * 2000, "exit_code": 0,
            })})
            context.check_budget(messages, [])
            self.assertLessEqual(self.input_size(messages), context.input_limit)
            if i == 0:
                self.assertGreater(self.input_size(messages), context.high)
                self.assertNotIn("truncated", json.loads(messages[-1]["content"]))
        for i, result in enumerate(messages[start+1::2]):
            self.assertEqual(result["tool_call_id"], str(i))
            self.assertEqual(json.loads(result["content"])["exit_code"], 0)
        self.assertTrue(json.loads(messages[start+1]["content"])["truncated"])
        self.summarize.assert_not_awaited()

    async def test_oversized_tool_schema_stops_before_send(self):
        context = ChatContext()
        messages = await context.build(self.client, "fixture", "default", [
            {"role": "system", "content": "s"}, {"role": "user", "content": "q"},
        ], [])
        with self.assertRaises(ContextError):
            context.check_budget(messages, [{"description": "x" * 90000}])
        self.summarize.assert_not_awaited()

    async def test_stream_reuses_messages_until_next_question(self):
        for size in (1700, 11450, 11450):
            retrieve.save_chat_messages("q", "a" * (3 * size))
        sent = []
        finish = SimpleNamespace(index=0, id="call", function=SimpleNamespace(
            name="search_tools", arguments='{"query":"history"}'))

        async def create(*, messages, stream=False, **kwargs):
            if not stream:
                return await self.summarize(messages=messages, **kwargs)
            sent.append(messages)
            calls = [] if messages[-1]["role"] == "tool" else [finish]
            if not calls:
                self.assertEqual(messages[-1]["tool_call_id"], "call")
                self.assertIn("read_chat_messages", [t["function"]["name"] for t in kwargs["tools"]])
            delta = SimpleNamespace(content=None if calls else "ok", tool_calls=calls)
            choice = SimpleNamespace(finish_reason="tool_calls" if calls else "stop", delta=delta)
            response = MagicMock()
            response.__aenter__.return_value.__aiter__.return_value = [SimpleNamespace(choices=[choice])]
            return response

        with patch.object(retrieve, "load_chat_context", wraps=retrieve.load_chat_context) as reads, \
             patch.object(chat_service, "AsyncOpenAI") as factory, \
             patch.object(chat_service.config, "get_env_param", return_value=dict(model="fixture", api_key="x", base_url="local")):
            factory.return_value.__aenter__.return_value.chat.completions.create = create
            for n in (1, 2):
                events = [event async for event in chat_service.stream_chat("q")]
                self.assertEqual(json.loads(events[-1][6:])["type"], "done")
                self.assertEqual(reads.call_count, n)
        self.assertEqual(len(sent), 4)
        self.assertIs(sent[0], sent[1])
        self.assertIsNot(sent[1], sent[2])
        self.assertIs(sent[2], sent[3])
        self.summarize.assert_awaited_once()

    async def test_large_backlog_uses_distinct_batches(self):
        for _ in range(22):
            retrieve.save_chat_messages("q", "a" * 10500)
        with patch.object(retrieve, "load_chat_context", wraps=retrieve.load_chat_context) as reads:
            messages = await self.build()
            reads.assert_called_once()
        self.assertLessEqual(self.input_size(messages), 14000)
        calls = self.summarize.await_count
        self.assertGreater(calls, 1)
        with retrieve._chat_db() as conn:
            ranges = conn.execute("SELECT first_id,last_id FROM chat_summaries ORDER BY first_id").fetchall()
        self.assertEqual(len(ranges), calls)
        self.assertTrue(all(a[1] + 1 == b[0] for a, b in zip(ranges, ranges[1:])))
        self.assertEqual(await self.build(), messages)
        self.assertEqual(self.summarize.await_count, calls)

    async def test_overlapping_requests_share_compaction(self):
        for size in (1700, 11450, 11450):
            retrieve.save_chat_messages("q", "a" * (3 * size))

        async def slow_summary(**kwargs):
            await asyncio.sleep(0.1)
            return self.summarize.return_value

        self.summarize.side_effect = slow_summary
        first, second = await asyncio.gather(self.build(), self.build())
        self.assertEqual(first, second)
        self.summarize.assert_awaited_once()
