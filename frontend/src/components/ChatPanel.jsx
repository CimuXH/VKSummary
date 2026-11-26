import { useCallback, useEffect, useRef, useState } from 'react'
import { createChatThread, getChatHistory, getChatThreads, streamChat } from '../api/chatClient'

const EMPTY_CHAT = { messages: [], draft: '', streaming: false, loaded: false, historyError: false }

export default function ChatPanel({ open, onClose, host }) {
  const [threads, setThreads] = useState(null)
  const [threadId, setThreadId] = useState('default')
  const [chats, setChats] = useState({})
  const [creating, setCreating] = useState(false)
  const [threadError, setThreadError] = useState('')
  const [pos, setPos] = useState({ x: 80, y: 60, w: 420, h: 560 })

  const posRef = useRef(pos)
  const bodyRef = useRef(null)
  const activeTabRef = useRef(null)
  const loadingHistory = useRef(new Set())
  const { messages, draft, streaming, loaded, historyError } = chats[threadId] ?? EMPTY_CHAT

  posRef.current = pos

  // 按会话 ID 更新局部状态，切换页签时其他页签的草稿和回答仍留在原处。
  const updateChat = useCallback((id, update) => {
    setChats((previous) => ({ ...previous, [id]: update(previous[id] ?? EMPTY_CHAT) }))
  }, [])

  const loadThreads = useCallback(async () => {
    setThreadError('')
    try {
      const items = await getChatThreads()
      setThreads((previous) => previous ?? items)
    } catch {
      setThreadError('加载会话失败')
    }
  }, [])

  useEffect(() => {
    if (open && !threads) loadThreads()
  }, [open, threads, loadThreads])

  const loadHistory = useCallback(async (id) => {
    if (loadingHistory.current.has(id)) return
    loadingHistory.current.add(id)
    updateChat(id, (chat) => ({ ...chat, historyError: false }))
    try {
      const history = await getChatHistory(id)
      // 本地可能已追加新消息，迟到的历史不能覆盖已加载的会话。
      updateChat(id, (chat) => chat.loaded ? chat : {
        ...chat,
        loaded: true,
        messages: history.map((item, index) => ({ ...item, id: index })),
      })
    } catch {
      updateChat(id, (chat) => ({ ...chat, historyError: !chat.loaded }))
    } finally {
      loadingHistory.current.delete(id)
    }
  }, [updateChat])

  useEffect(() => {
    if (open && !loaded) loadHistory(threadId)
  }, [open, loaded, threadId, loadHistory])

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [open, threadId, threads])

  // 新消息自动滚动到底部
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [messages])

  if (!open) return null

  const getBounds = () => {
    const hostRect = host.getBoundingClientRect()
    const parent = host.parentElement
    let minLeft = 0

    if (parent) {
      const sidebar = parent.querySelector('aside')
      if (sidebar) {
        const sidebarRect = sidebar.getBoundingClientRect()
        minLeft = sidebarRect.right - hostRect.left
      }
    }

    return {
      minLeft,
      minTop: 0,
      maxRight: hostRect.width,
      maxBottom: hostRect.height,
    }
  }

  const startDrag = (e) => {
    if (e.button !== 0) return
    e.preventDefault()

    const bounds = getBounds()
    const start = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      x: posRef.current.x,
      y: posRef.current.y,
    }

    const onMove = (ev) => {
      const nx = Math.min(
        Math.max(start.x + ev.clientX - start.mouseX, bounds.minLeft),
        Math.max(bounds.minLeft, bounds.maxRight - posRef.current.w)
      )
      const ny = Math.min(
        Math.max(start.y + ev.clientY - start.mouseY, bounds.minTop),
        Math.max(bounds.minTop, bounds.maxBottom - 40)
      )

      setPos((p) => ({ ...p, x: nx, y: ny }))
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startResize = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const bounds = getBounds()
    const start = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      w: posRef.current.w,
      h: posRef.current.h,
      x: posRef.current.x,
      y: posRef.current.y,
    }

    const onMove = (ev) => {
      const dw = ev.clientX - start.mouseX
      const dh = ev.clientY - start.mouseY

      const nw = Math.min(Math.max(start.w + dw, 320), bounds.maxRight - start.x)
      const nh = Math.min(Math.max(start.h + dh, 320), bounds.maxBottom - start.y)

      setPos((p) => ({ ...p, w: nw, h: nh }))
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleCreate = async () => {
    if (!threads || creating) return
    setCreating(true)
    setThreadError('')
    try {
      const thread = await createChatThread()
      updateChat(thread.id, (chat) => ({ ...chat, loaded: true }))
      setThreads((previous) => [...previous, thread])
      setThreadId(thread.id)
    } catch {
      setThreadError('新建会话失败，请重试')
    } finally {
      setCreating(false)
    }
  }

  const handleSend = async () => {
    const question = draft.trim()
    if (!question || streaming || !loaded) return

    // 捕获发送时的会话 ID。用户切到 B 后，A 的流式回调依然只更新 A。
    const requestThread = threadId
    const assistantId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    updateChat(requestThread, (chat) => ({
      ...chat,
      draft: '',
      streaming: true,
      messages: [
        ...chat.messages,
        { id: userId, role: 'user', content: question },
        { id: assistantId, role: 'assistant', content: '', streaming: true },
      ],
    }))

    const updateReply = (content, generating) => updateChat(requestThread, (chat) => ({
      ...chat,
      streaming: generating,
      messages: chat.messages.map((message) => message.id === assistantId
        ? { ...message, content: content(message.content), streaming: generating }
        : message),
    }))

    try {
      const answer = await streamChat(question, requestThread, (delta) => {
        updateReply((text) => text + delta, true)
      })
      updateReply(() => answer, false)
    } catch (error) {
      updateReply(() => '错误：' + error.message, false)
    }
  }

  return (
    <div
      className="absolute flex flex-col bg-white border border-black/10 rounded-2xl shadow-2xl overflow-hidden"
      style={{
        left: pos.x,
        top: pos.y,
        width: pos.w,
        height: pos.h,
        pointerEvents: 'auto',
      }}
    >
      {/* 标题栏：可拖动 */}
      <div
        className="flex items-center justify-between px-4 py-2 bg-warm-900 text-white cursor-move select-none shrink-0"
        onMouseDown={startDrag}
      >
        <span className="text-sm font-medium">AI 对话</span>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
          title="关闭"
        >
          ×
        </button>
      </div>

      <div className="flex gap-2 border-b border-black/10 bg-white px-2 py-1.5 shrink-0">
        <div aria-label="会话列表" className="flex flex-1 min-w-0 items-center gap-1 overflow-x-auto">
          {(threads ?? []).map(({ id }, index) => (
            <button
              key={id}
              ref={id === threadId ? activeTabRef : null}
              aria-pressed={id === threadId}
              onClick={() => setThreadId(id)}
              className={'whitespace-nowrap rounded-md px-2 py-1 text-xs ' +
                (id === threadId ? 'bg-blue-50 text-blue-700' : 'text-warm-600 hover:bg-warm-100')}
            >
              {id === 'default' ? '默认对话' : '对话 ' + index}
              {chats[id]?.streaming && ' · 生成中'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={!threads || creating}
          className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-40"
        >
          {creating ? '创建中…' : '+ 新建对话'}
        </button>
      </div>
      {threadError && (
        <div role="alert" className="px-3 py-1 text-xs text-red-700">
          {threadError}
          {!threads && <button onClick={loadThreads} className="ml-2 underline">重试</button>}
        </div>
      )}

      {/* 消息区 */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-[#faf9f6]">
        {!loaded && (
          <p className="text-center text-xs text-warm-500 py-8">
            {historyError
              ? <button onClick={() => loadHistory(threadId)} className="underline">历史加载失败，点击重试</button>
              : '正在加载对话…'}
          </p>
        )}
        {loaded && messages.length === 0 && (
          <p className="text-center text-xs text-warm-400 py-8">开始和你的字幕知识库对话吧</p>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`w-fit max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'ml-auto bg-blue-600 text-white'
                : 'mr-auto bg-white border border-black/5 text-warm-800'
            }`}
          >
            {msg.content}
            {msg.streaming && <span className="inline-block w-1.5 h-4 ml-1 bg-current animate-pulse" />}
          </div>
        ))}
      </div>

      {/* 输入区 */}
      <div className="flex items-center gap-2 border-t border-black/5 bg-white py-1.5 px-2 shrink-0">
        <input
          value={draft}
          onChange={(event) => {
            const value = event.target.value
            updateChat(threadId, (chat) => ({ ...chat, draft: value }))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="输入问题..."
          className="flex-1 px-3 py-2 text-sm border border-black/10 rounded-lg bg-[#f7f6f3] outline-none focus:border-blue-400"
        />
        <button
          onClick={handleSend}
          disabled={!loaded || streaming || !draft.trim()}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {streaming ? '生成中...' : '发送'}
        </button>
      </div>

      {/* 右下角缩放手柄 */}
      <div
        onMouseDown={startResize}
        className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize"
        style={{
          background: 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.2) 50%)',
        }}
      />
    </div>
  )
}
