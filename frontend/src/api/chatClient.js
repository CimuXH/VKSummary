// Chat 请求统一经过 Vite 的 /api 转发。
async function requestChat(path, options) {
  const res = await fetch(path, options)
  if (!res.ok) {
    const error = await res.json().catch(() => null)
    throw new Error(typeof error?.detail === 'string' ? error.detail : 'Chat 请求失败')
  }
  return res
}

export async function getChatThreads() {
  const res = await requestChat('/api/chat/threads')
  return (await res.json()).data
}

export async function createChatThread() {
  const res = await requestChat('/api/chat/threads', { method: 'POST' })
  return res.json()
}

export async function getChatHistory(threadId) {
  const params = new URLSearchParams({ thread_id: threadId })
  const res = await requestChat('/api/chat/history?' + params)
  return (await res.json()).data
}

// delta 用于显示实时文字，done 才代表后端已保存完整问答。
export async function streamChat(question, threadId, onDelta) {
  const res = await requestChat('/api/chat/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: question, thread_id: threadId }),
  })
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      // 一个事件可能被拆成多个网络块，保留尚未读完的那一行。
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = done ? '' : lines.pop()

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        let event
        try {
          event = JSON.parse(line.slice(5))
        } catch {
          continue
        }
        if (event.type === 'delta') onDelta?.(event.delta)
        if (event.type === 'done') return event.answer
        if (event.type === 'error') throw new Error(event.message)
      }
      if (done) throw new Error('回答连接已中断')
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}
