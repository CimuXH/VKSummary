import { useEffect, useRef, useState } from 'react'
import { getChatHistory, streamChat } from '../api/chatClient'

export default function ChatPanel({ open, onClose, host }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [pos, setPos] = useState({ x: 80, y: 60, w: 420, h: 560 })

  const posRef = useRef(pos)
  const bodyRef = useRef(null)
  const historyLoaded = useRef(false)

  posRef.current = pos

  // 打开时加载历史
  useEffect(() => {
    if (!open || historyLoaded.current) return
    historyLoaded.current = true

    getChatHistory()
      .then((history) => {
        setMessages(
          history.map((item, index) => ({
            id: index,
            role: item.role,
            content: item.content,
          }))
        )
      })
      .catch(() => {
        // 历史加载失败不阻塞聊天
      })
  }, [open])

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

  const handleSend = async () => {
    const question = input.trim()
    if (!question || streaming) return

    // 使用唯一 id，避免消息 id 冲突导致渲染错乱
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()

    setInput('')
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: question },
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ])

    setStreaming(true)

    await streamChat(question, {
      onDelta: (delta) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + delta } : m
          )
        )
      },
      onDone: (answer) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: answer || m.content, streaming: false }
              : m
          )
        )
        setStreaming(false)
      },
      onError: (message) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `错误：${message}`, streaming: false }
              : m
          )
        )
        setStreaming(false)
      },
    })
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

      {/* 消息区 */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-[#faf9f6]">
        {messages.length === 0 && (
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
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
          disabled={streaming || !input.trim()}
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
