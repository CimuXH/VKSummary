import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
})

// ── Video ──
export async function getVideoInfo(videoUrl) {
  const { data } = await api.post('/video/get_video_info', { video_url: videoUrl })
  return data
}

export async function getVideoSubtitles(bvid, pages) {
  const { data } = await api.post('/video/start_video_subtitles', { bvid, pages })
  return data
}

// ***
// 连接 SSE 获取任务进度
// 返回 EventSource 实例，调用方可 .close() 断开
// ***
export function connectTaskSSE(bvidUid, onMessage, onError) {
  const es = new EventSource(`/api/task/sse/${bvidUid}`)

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      onMessage(data)
      // 收到 phase="done" 或有 error → 断开 SSE
      if (data.phase === 'done' || data.error) es.close()
    } catch {
      // 解析失败忽略
    }
  }

  es.onerror = () => {
    es.close()
    if (onError) onError()
  }

  return es
}

// ── Task ──
export async function getTaskResponse(bvidUid) {
  const { data } = await api.get(`/task/task_response/${bvidUid}`)
  return data
}

export async function deleteFinishedTask(bvidUid) {
  const { data } = await api.delete(`/task/finished_task/${bvidUid}`)
  return data
}

export async function getAllTaskList() {
  const { data } = await api.get('/task/all_task_list')
  return data
}

// ── Settings ──
export async function saveEnvParam(params) {
  const { data } = await api.post('/settings/set_env_param', params)
  return data
}

export async function getEnvParam() {
  const { data } = await api.get('/settings/get_env_param')
  return data
}

export async function testEnvParam(params) {
  const { data } = await api.post('/settings/test_env', params)
  return data
}
