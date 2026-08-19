// Chat 相关 API 封装

export async function getChatHistory() {
  const res = await fetch('/api/chat/history')
  if (!res.ok) {
    throw new Error('获取历史对话失败')
  }
  const json = await res.json()
  return json.data || []
}

// 流式对话
// onDelta: 收到一段回答文本
// onDone: 回答完成
// onError: 出错
export async function streamChat(question, { onDelta, onDone, onError }) {
  const res = await fetch('/api/chat/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: question }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    onError?.(text || '请求失败')
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue

      try {
        const data = JSON.parse(trimmed.slice(5).trim())

        if (data.type === 'delta' && data.delta) {
          onDelta?.(data.delta)
        } else if (data.type === 'done') {
          onDone?.(data.answer || '')
        } else if (data.type === 'error') {
          onError?.(data.message || '未知错误')
        }
      } catch {
        // 忽略解析失败的数据行
      }
    }
  }

  // 处理最后可能剩余的一行
  if (buffer.trim()) {
    const trimmed = buffer.trim()
    if (trimmed.startsWith('data:')) {
      try {
        const data = JSON.parse(trimmed.slice(5).trim())
        if (data.type === 'done') onDone?.(data.answer || '')
        else if (data.type === 'error') onError?.(data.message || '未知错误')
      } catch {
        // 忽略
      }
    }
  }
}
