import { useState, useEffect, useCallback, useRef } from 'react'
import TopBar from './components/TopBar'
import EnvConfigModal from './components/EnvConfigModal'
import TaskSidebar from './components/TaskSidebar'
import EpisodeList from './components/EpisodeList'
import VideoPanel from './components/VideoPanel'
import MindMapPanel from './components/MindMapPanel'
import OutlinePanel from './components/OutlinePanel'
import { getTaskResponse, getAllTaskList, connectTaskSSE, getEnvParam, testEnvParam, deleteFinishedTask } from './api/client'
import bgSvg from './assets/vksummary_background_subtle.svg'

const STORAGE_KEY = 'vksummary_tasks'

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
}

export default function App() {
  const [envConfigured, setEnvConfigured] = useState(false)
  const [showEnvModal, setShowEnvModal] = useState(false)
  const [tasks, setTasks] = useState(loadTasks)
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [videoInfo, setVideoInfo] = useState(null)
  const [downloadBvidUid, setDownloadBvidUid] = useState(null)
  const [showMindMap, setShowMindMap] = useState(false)
  const [mindMapData, setMindMapData] = useState(null)
  const [mindMapLoading, setMindMapLoading] = useState(false)
  const [layoutMode, setLayoutMode] = useState('hero') // 'hero' | 'normal'
  const [resetKey, setResetKey] = useState(0)
  const [completedTasks, setCompletedTasks] = useState([])
  const [selectedEpisode, setSelectedEpisode] = useState(null) // null=总览, number=集索引
  const [showOutline, setShowOutline] = useState(false) // 右侧节点导航抽屉

  // SSE 连接与消息历史由 App 统一管理：
  // 生命周期跟随"任务"而不是 VideoPanel 组件，切换页面（如查看其它任务的图）不会断开/丢失
  const [taskMessages, setTaskMessages] = useState({}) // { bvid_uid: [entry, ...] }
  const sseRef = useRef(null)                          // 当前唯一的 SSE 连接
  const msgIdRef = useRef(0)

  // On mount: load completed task list + 自动加载并实测环境变量（通过→绿，失败→红）
  useEffect(() => {
    // 先沿用上次已知状态，避免测试期间红色闪烁
    const tested = localStorage.getItem('vksummary_env_tested')
    if (tested === '1') setEnvConfigured(true)

    getAllTaskList()
      .then(res => { if (res?.data) setCompletedTasks(res.data) })
      .catch(() => {}) // silent fail — sidebar just shows empty

    // 获取环境变量参数，全部非空则实测是否可用
    getEnvParam()
      .then((params) => {
        const hasAll = params && Object.values(params).every((v) => v && String(v).trim())
        if (!hasAll) {
          setEnvConfigured(false)
          return
        }
        return testEnvParam(params)
          .then(() => {
            setEnvConfigured(true)   // 测试通过 → 绿色
            localStorage.setItem('vksummary_env_tested', '1')
          })
          .catch(() => {
            setEnvConfigured(false)  // 测试失败 → 红色
            localStorage.removeItem('vksummary_env_tested')
          })
      })
      .catch(() => {}) // 获取参数失败 → 保持当前状态
  }, [])

  // Persist tasks to localStorage
  useEffect(() => {
    saveTasks(tasks)
  }, [tasks])

  // Reset mind map when switching tasks
  useEffect(() => {
    setShowMindMap(false)
    setMindMapData(null)
    setSelectedEpisode(null)
    setShowOutline(false)
  }, [selectedTaskId])

  const handleEnvSaved = useCallback((testedOk) => {
    if (testedOk) {
      localStorage.setItem('vksummary_env_tested', '1')
      setEnvConfigured(true)
    } else {
      localStorage.removeItem('vksummary_env_tested')
      setEnvConfigured(false)
    }
    setShowEnvModal(false)
  }, [])

  const addTask = useCallback((task) => {
    setTasks((prev) => {
      const exists = prev.find((t) => t.bvid_uid === task.bvid_uid)
      if (exists) return prev
      return [task, ...prev]
    })
    setSelectedTaskId(task.bvid_uid)
  }, [])

  const updateTaskProgress = useCallback((bvidUid, phase, message, done, error) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.bvid_uid === bvidUid
          ? { ...t, phase, message, done, error: error || null, status: error ? 'failed' : done ? 'completed' : 'processing' }
          : t
      )
    )
  }, [])

  const selectedTask = tasks.find((t) => t.bvid_uid === selectedTaskId) || null

  const handleHeroSearch = useCallback((info) => {
    setVideoInfo(info)
    setSelectedTaskId(null)
    setShowMindMap(false)
    setMindMapData(null)
  }, [])

  const handleViewMindMap = useCallback(async (bvidUid) => {
    const uid = bvidUid || selectedTask?.bvid_uid
    if (!uid) return
    setMindMapLoading(true)
    try {
      const result = await getTaskResponse(uid)
      setMindMapData(result)
      setShowMindMap(true)
    } catch (err) {
      console.error('获取任务结果失败:', err)
      // 即使失败也展示面板，让用户看到错误状态
      setMindMapData(null)
      setShowMindMap(true)
    } finally {
      setMindMapLoading(false)
    }
  }, [selectedTask])

  // Called when SSE signals task complete
  const handleTaskComplete = useCallback((bvidUid) => {
    // Refresh completed task list (this task just finished)
    getAllTaskList()
      .then(res => { if (res?.data) setCompletedTasks(res.data) })
      .catch(() => {})
    handleViewMindMap(bvidUid)
  }, [handleViewMindMap])

  // 启动（或切换）SSE 连接——连接归 App 管，消息历史写入 taskMessages
  const connectTaskStream = useCallback((bvidUid) => {
    if (sseRef.current) sseRef.current.close()

    const now = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const append = (entry) =>
      setTaskMessages((prev) => ({ ...prev, [bvidUid]: [...(prev[bvidUid] || []), entry] }))

    // 立即插入一条启动消息，切走再切回时也有内容可看
    append({ id: ++msgIdRef.current, time: now(), phase: 'subtitles', message: '任务启动中...', done: false, error: null, status: 'processing' })

    sseRef.current = connectTaskSSE(bvidUid,
      (data) => {
        const entry = {
          id: ++msgIdRef.current,
          time: now(),
          phase: data.phase,
          message: data.message,
          done: data.done,
          error: data.error || null,
          status: data.error ? 'failed'
            : data.phase === 'done' ? 'completed'
            : 'processing',
        }
        append(entry)
        updateTaskProgress(bvidUid, entry.phase, entry.message, entry.done, entry.error)

        // 整体流程结束（client.js 收到 done 后已自动关闭连接）
        if (data.phase === 'done') {
          sseRef.current = null
          // 失败的任务不自动打开思维导图
          if (!data.error) handleTaskComplete(bvidUid)
        }
      },
      () => {
        // 连接异常断开（非 done）：记录一条提示，不改变任务状态
        sseRef.current = null
        append({ id: ++msgIdRef.current, time: now(), phase: null, message: 'SSE 连接断开', done: false, error: 'SSE 连接断开', status: 'processing' })
      }
    )
  }, [updateTaskProgress, handleTaskComplete])

  // 页面刷新后：为仍在处理中的任务恢复 SSE 连接（后端队列会先吐出积压消息）
  useEffect(() => {
    const processing = tasks.filter((t) => t.status === 'processing' && t.bvid_uid)
    if (processing.length > 0) {
      connectTaskStream(processing[processing.length - 1].bvid_uid)
    }
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Click a history (completed) task → fetch summary + show mind map
  const handleSelectHistory = useCallback((bvidUid) => {
    setSelectedEpisode(null) // reset to overview
    handleViewMindMap(bvidUid)
  }, [handleViewMindMap])

  // Episode selection in collection view
  const handleSelectEpisode = useCallback((index) => {
    setSelectedEpisode(index)
  }, [])

  // Dismiss a failed task
  const handleDismissTask = useCallback((bvidUid) => {
    setTasks((prev) => prev.filter((t) => t.bvid_uid !== bvidUid))
    setTaskMessages((prev) => {
      const next = { ...prev }
      delete next[bvidUid]
      return next
    })
    if (selectedTaskId === bvidUid) setSelectedTaskId(null)
  }, [selectedTaskId])

  // 管理模式下删除选中的任务：后端删除文件，本地同步移除状态
  const handleDeleteTasks = useCallback(async (bvidUids) => {
    for (const uid of bvidUids) {
      try {
        await deleteFinishedTask(uid)
      } catch (err) {
        console.error('删除任务失败:', uid, err)
      }
    }
    setCompletedTasks((prev) => prev.filter((t) => !bvidUids.includes(t.bvid_uid)))
    setTasks((prev) => prev.filter((t) => !bvidUids.includes(t.bvid_uid)))
    setTaskMessages((prev) => {
      const next = { ...prev }
      bvidUids.forEach((u) => delete next[u])
      return next
    })
    setSelectedTaskId((prev) => (bvidUids.includes(prev) ? null : prev))
  }, [])

  const handleCloseMindMap = useCallback(() => {
    setShowMindMap(false)
    setMindMapData(null)
    setSelectedEpisode(null)
    setSelectedTaskId(null)
    setVideoInfo(null)
    setLayoutMode('hero')
    setShowOutline(false)
    setResetKey((k) => k + 1)
  }, [])

  const handleResetToHome = useCallback(() => {
    setVideoInfo(null)
    setSelectedTaskId(null)
    setLayoutMode('hero')
    setShowMindMap(false)
    setMindMapData(null)
    setShowOutline(false)
    setResetKey((k) => k + 1)
    // Refresh completed task list on home
    getAllTaskList()
      .then(res => { if (res?.data) setCompletedTasks(res.data) })
      .catch(() => {})
  }, [])

  // Restore videoInfo from selected task if available
  useEffect(() => {
    if (!videoInfo && selectedTask?.videoInfo) {
      setVideoInfo(selectedTask.videoInfo)
    }
  }, [selectedTask, videoInfo])

  // SSE 消息历史：当前选中任务的全部消息
  const selectedTaskMessages = selectedTask ? (taskMessages[selectedTask.bvid_uid] || []) : []

  return (
    <div className="h-full flex flex-col relative">
      {/* Background SVG — subtle, behind everything */}
      <img
        src={bgSvg}
        alt=""
        className="absolute inset-0 w-full h-full object-cover pointer-events-none -z-10"
        draggable={false}
      />

      {/* Top bar */}
      <TopBar
        envConfigured={envConfigured}
        onEnvClick={() => setShowEnvModal(true)}
        onLogoClick={handleResetToHome}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Column 1: Task sidebar — always visible */}
        <TaskSidebar
          liveTasks={tasks}
          completedTasks={completedTasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
          onSelectHistory={handleSelectHistory}
          onDismissTask={handleDismissTask}
          onDeleteTasks={handleDeleteTasks}
          outlineEnabled={!!mindMapData}
          onToggleOutline={() => setShowOutline((v) => !v)}
        />

        {/* Episode list — visible when showing a collection mind map */}
        {showMindMap && mindMapData?.data?.type === 'collection' && (
          <EpisodeList
            mindMapData={mindMapData}
            selectedEpisode={selectedEpisode}
            onSelectEpisode={handleSelectEpisode}
          />
        )}

        {/* Mind map full view — replaces hero/normal content */}
        {showMindMap ? (
          <MindMapPanel
            selectedTask={selectedTask}
            showMindMap={true}
            mindMapData={mindMapData}
            mindMapLoading={mindMapLoading}
            selectedEpisode={selectedEpisode}
            onViewMindMap={handleViewMindMap}
            onCloseMindMap={handleCloseMindMap}
          />
        ) : layoutMode === 'hero' ? (
          <VideoPanel
            key={resetKey}
            selectedTask={selectedTask}
            videoInfo={videoInfo}
            setVideoInfo={setVideoInfo}
            downloadBvidUid={downloadBvidUid}
            setDownloadBvidUid={setDownloadBvidUid}
            onAddTask={addTask}
            messages={selectedTaskMessages}
            onStartSSE={connectTaskStream}
            showHero={true}
            onHeroSearch={handleHeroSearch}
          />
        ) : (
          <>
            {/* Column 2: Video panel */}
            <VideoPanel
              selectedTask={selectedTask}
              videoInfo={videoInfo}
              setVideoInfo={setVideoInfo}
              downloadBvidUid={downloadBvidUid}
              setDownloadBvidUid={setDownloadBvidUid}
              onAddTask={addTask}
              messages={selectedTaskMessages}
              onStartSSE={connectTaskStream}
              showHero={false}
              onHeroSearch={handleHeroSearch}
            />

            {/* Column 3: Mind map panel */}
            <MindMapPanel
              selectedTask={selectedTask}
              showMindMap={false}
              mindMapData={mindMapData}
              mindMapLoading={mindMapLoading}
              onViewMindMap={handleViewMindMap}
              onCloseMindMap={handleCloseMindMap}
            />
          </>
        )}
      </div>

      {/* 右侧节点导航抽屉 */}
      {showOutline && mindMapData && (
        <OutlinePanel
          mindMapData={mindMapData}
          selectedEpisode={selectedEpisode}
          onClose={() => setShowOutline(false)}
        />
      )}

      {/* Env config modal */}
      {showEnvModal && (
        <EnvConfigModal
          onClose={() => setShowEnvModal(false)}
          onSaved={handleEnvSaved}
        />
      )}
    </div>
  )
}
