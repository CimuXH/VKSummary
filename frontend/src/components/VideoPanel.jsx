import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Search, Download, Loader2, CheckCircle2, XCircle,
  Film, Clock, AlertCircle,
} from 'lucide-react'
import { getVideoInfo, getVideoSubtitles } from '../api/client'

export default function VideoPanel({
  selectedTask, videoInfo, setVideoInfo,
  downloadBvidUid, setDownloadBvidUid,
  onAddTask, messages, onStartSSE,
  showHero, onHeroSearch,
}) {
  const [url, setUrl] = useState('')
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [infoError, setInfoError] = useState('')
  const [selectedPages, setSelectedPages] = useState([])
  const [downloading, setDownloading] = useState(false)
  const [brokenImgs, setBrokenImgs] = useState(new Set())
  const historyEndRef = useRef(null)

  // 最新一条 SSE 消息（完整历史保存在 App 层，组件卸载后切回来也不丢）
  const latestMsg = messages[messages.length - 1]

  // Auto-scroll history list to bottom when new entries arrive
  useEffect(() => {
    if (historyEndRef.current) {
      historyEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  // When selected task changes, restore its state
  useEffect(() => {
    if (selectedTask) {
      setDownloadBvidUid(selectedTask.bvid_uid)
      setVideoInfo(selectedTask.videoInfo || null)
      setSelectedPages(selectedTask.pages || [])
    }
  }, [selectedTask, setDownloadBvidUid, setVideoInfo])

  // --- Hero search mode handlers ---
  const handleHeroResolve = async () => {
    if (!url.trim()) return
    setLoadingInfo(true)
    setInfoError('')
    setBrokenImgs(new Set())
    try {
      const info = await getVideoInfo(url.trim())
      // Auto-select the page matching current_page (from URL p= param)
      const currentPage = info.pages?.find(p => p.page === info.current_page)
      if (currentPage) {
        setSelectedPages([currentPage])
      } else if (info.video_type === 'single' && info.pages?.length === 1) {
        setSelectedPages([info.pages[0]])
      }
      onHeroSearch(info)
    } catch (err) {
      setInfoError(err?.response?.data?.detail || '获取视频信息失败')
    } finally {
      setLoadingInfo(false)
    }
  }

  const handleNormalResolve = async () => {
    if (!url.trim()) return
    setLoadingInfo(true)
    setInfoError('')
    setVideoInfo(null)
    setSelectedPages([])
    setBrokenImgs(new Set())
    try {
      const info = await getVideoInfo(url.trim())
      setVideoInfo(info)
      if (info.video_type === 'single' && info.pages?.length === 1) {
        setSelectedPages([info.pages[0]])
      }
    } catch (err) {
      setInfoError(err?.response?.data?.detail || '获取视频信息失败')
    } finally {
      setLoadingInfo(false)
    }
  }

  const togglePage = (page) => {
    setSelectedPages((prev) => {
      const idx = prev.findIndex((p) => p.cid === page.cid)
      if (idx >= 0) return prev.filter((p) => p.cid !== page.cid)
      return [...prev, page]
    })
  }

  const toggleAllPages = () => {
    if (!videoInfo?.pages) return
    if (selectedPages.length === videoInfo.pages.length) {
      setSelectedPages([])
    } else {
      setSelectedPages([...videoInfo.pages])
    }
  }

  const handleDownload = async () => {
    if (!videoInfo?.bvid || selectedPages.length === 0) return
    setDownloading(true)
    try {
      const result = await getVideoSubtitles(videoInfo.bvid, selectedPages)
      const bvidUid = result.bvid_uid

      const task = {
        bvid_uid: bvidUid,
        bvid: videoInfo.bvid,
        videoTitle: videoInfo.pages?.[0]?.part || videoInfo.bvid,
        videoInfo,
        pages: selectedPages,
        total: selectedPages.length,
        status: 'processing',
        phase: null,
        message: null,
        done: false,
        error: null,
        createdAt: Date.now(),
      }
      onAddTask(task)
      setDownloadBvidUid(bvidUid)

      // SSE 连接与消息历史由 App 统一管理（不随本组件卸载而断开）
      onStartSSE(bvidUid)
    } catch (err) {
      setInfoError(err?.response?.data?.detail || '下载失败')
    } finally {
      setDownloading(false)
    }
  }

  const formatDuration = (sec) => {
    if (!sec) return ''
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // ========================
  // Hero search mode
  // ========================
  if (showHero) {
    const hasResult = videoInfo !== null

    return (
      <aside className="flex-1 flex items-center justify-center bg-transparent overflow-y-auto">
        <div className="w-full max-w-4xl px-8 -mt-24">
          {/* Branding — shrinks when result shown */}
          <div className={`text-center transition-all duration-700 ease-out
                          ${hasResult ? 'mb-4' : 'mb-10'}`}>
            <h2 className={`font-bold text-warm-900 tracking-tight transition-all duration-700 ease-out
                           ${hasResult ? 'text-2xl mb-1' : 'text-[38px] mb-3'}`}>
              VKSummary
            </h2>
            {!hasResult && (
              <p className="text-base text-warm-400">
                粘贴 B站视频链接，AI 帮你提炼知识框架
              </p>
            )}
          </div>

          {/* Search bar — floating card, slides up with branding when results appear */}
          <div className={`card-float-heavy bg-white border border-black/5 rounded-2xl overflow-hidden
                         transition-all duration-700 ease-out
                         ${hasResult
                           ? '-translate-y-1 shadow-lg'
                           : '-translate-y-1.5 shadow-2xl hover:translate-y-0 hover:shadow-[0_6px_20px_rgba(0,0,0,0.06)]'}`}>
            <div className="flex items-center p-2">
              <input
                type="text"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setInfoError('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleHeroResolve() }}
                placeholder="粘贴 Bilibili 视频链接..."
                className="flex-1 px-5 py-4 text-base bg-transparent text-warm-900
                           placeholder:text-warm-300 outline-none
                           hover:placeholder:text-warm-400 transition-colors"
                autoFocus
              />
              <button
                onClick={handleHeroResolve}
                disabled={loadingInfo || !url.trim()}
                className={`bg-warm-900 text-white font-medium rounded-xl
                           hover:bg-warm-700 active:scale-[0.98]
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-all flex items-center justify-center shrink-0
                           ${hasResult ? 'w-12 h-12 p-0' : 'px-7 py-4 text-base gap-2'}`}
              >
                {loadingInfo ? (
                  <Loader2 size={hasResult ? 20 : 18} className="animate-spin" />
                ) : (
                  <Search size={hasResult ? 20 : 18} />
                )}
                {!hasResult && <span>{loadingInfo ? '解析中...' : '解析视频'}</span>}
              </button>
            </div>
          </div>

          {/* Error */}
          {infoError && (
            <p className="mt-3 text-sm text-red-500 flex items-center justify-center gap-1.5">
              <AlertCircle size={14} /> {infoError}
            </p>
          )}

          {/* ── Video result list — separate card with gap ── */}
          {hasResult && !latestMsg && (
            <div className="mt-2 card-float-heavy bg-white border border-black/5 rounded-2xl overflow-hidden
                           animate-slideDown">
              {/* Header */}
              {videoInfo.video_type === 'multi' && videoInfo.pages?.length > 1 && (
                <div className="px-5 py-2.5 flex items-center justify-between
                               border-b border-black/5 bg-[#faf9f6]">
                  <span className="text-xs font-medium text-warm-500 flex items-center gap-2">
                    <Film size={13} className="text-warm-400" />
                    选集
                    <span className="text-warm-300 font-normal">
                      {selectedPages.length}/{videoInfo.pages.length} 已选
                    </span>
                  </span>
                  <button
                    onClick={toggleAllPages}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium
                               transition-colors px-2 py-0.5 rounded hover:bg-blue-50"
                  >
                    {selectedPages.length === videoInfo.pages.length ? '取消全选' : '全选'}
                  </button>
                </div>
              )}

              {/* Episode list */}
              <div className="max-h-[360px] overflow-y-auto">
                {videoInfo.pages?.map((page) => {
                  const isSelected = selectedPages.some((p) => p.cid === page.cid)
                  const isCurrentPage = page.page === videoInfo.current_page
                  return (
                    <button
                      key={page.cid}
                      onClick={() => togglePage(page)}
                      className={`w-full flex items-center gap-3.5 px-5 py-3 text-left
                                 transition-all duration-150 group
                                 ${isSelected
                                   ? 'bg-blue-50/50 border-l-[3px] border-l-blue-500'
                                   : 'border-l-[3px] border-l-transparent hover:bg-[#faf9f6]'}`}
                    >
                      {/* Thumbnail */}
                      <div className="w-12 h-7 rounded overflow-hidden shrink-0 relative">
                        {page.first_frame && !brokenImgs.has(page.cid) ? (
                          <img
                            src={page.first_frame.replace(/^http:\/\//, 'https://')}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={() => setBrokenImgs(prev => new Set([...prev, page.cid]))}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center
                                         bg-[#e8e5e0]">
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="#a8a39b" opacity="0.8">
                              <polygon points="8,5 8,19 19,12" />
                            </svg>
                          </div>
                        )}
                        {/* Duration badge — clean overlay pill */}
                        {page.duration && (
                          <span className="absolute bottom-1 right-1 text-[10px] font-medium
                                          bg-black/70 text-white px-1.5 py-0.5 rounded
                                          leading-none tracking-tight">
                            {formatDuration(page.duration)}
                          </span>
                        )}
                      </div>

                      {/* Title + meta */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {videoInfo.video_type === 'multi' && (
                            <span className="text-[10px] font-semibold text-warm-400 shrink-0
                                            bg-warm-100 px-1 py-px rounded">
                              P{page.page}
                            </span>
                          )}
                          <p className="text-sm font-medium text-warm-800 truncate
                                       group-hover:text-warm-900 transition-colors">
                            {page.part}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-warm-400 font-mono">
                            cid:{page.cid}
                          </span>
                          {isCurrentPage && (
                            <span className="text-[10px] font-medium text-green-600
                                            bg-green-50 px-1.5 py-px rounded-full">
                              当前集
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Checkbox */}
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center
                                    shrink-0 transition-all duration-200
                                    ${isSelected
                                      ? 'border-blue-500 bg-blue-500 scale-100'
                                      : 'border-warm-300 group-hover:border-warm-400 scale-90'}`}
                      >
                        {isSelected && <CheckCircle2 size={12} className="text-white" />}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Footer — video info + download */}
              <div className="px-5 py-3 border-t border-black/5 bg-[#faf9f6]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-xs text-warm-500">
                    <span className="font-mono text-warm-400">{videoInfo.bvid}</span>
                    <span className="w-1 h-1 rounded-full bg-warm-300" />
                    <span>
                      {videoInfo.video_type === 'single' ? '单视频' : `共${videoInfo.pages?.length || 0}集`}
                    </span>
                    {selectedPages.length > 0 && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-warm-300" />
                        <span className="text-blue-600 font-medium">
                          已选 {selectedPages.length} 集
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleDownload}
                  disabled={downloading || selectedPages.length === 0}
                  className="w-full py-2.5 text-sm font-medium rounded-xl
                             bg-blue-600 text-white
                             hover:bg-blue-700 active:scale-[0.98]
                             disabled:opacity-40 disabled:cursor-not-allowed
                             transition-all flex items-center justify-center gap-2
                             shadow-sm hover:shadow-md"
                >
                  {downloading
                    ? <><Loader2 size={14} className="animate-spin" /> 启动中...</>
                    : <><Download size={14} /> 解析字幕 ({selectedPages.length}集)</>}
                </button>
              </div>
            </div>
          )}

          {/* ── Download progress — replaces video list ── */}
          {latestMsg && (
            <div className="mt-2 card-float-heavy bg-white border border-black/5 rounded-2xl overflow-hidden
                           animate-slideDown max-h-[420px] flex flex-col">
              {/* Header + bar */}
              <div className="px-5 py-4 shrink-0">
                <div className="flex items-center gap-3 mb-4">
                  {latestMsg.status === 'completed' ? (
                    <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
                      <CheckCircle2 size={18} className="text-green-600" />
                    </div>
                  ) : latestMsg.status === 'failed' ? (
                    <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center">
                      <XCircle size={18} className="text-red-500" />
                    </div>
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                      <Loader2 size={18} className="text-blue-600 animate-spin" />
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-warm-800">
                      {latestMsg.status === 'completed' && '任务完成'}
                      {latestMsg.status === 'failed' && '任务失败'}
                      {latestMsg.status === 'processing' && (latestMsg.message || '任务处理中...')}
                    </p>
                    <p className="text-xs text-warm-400 mt-0.5">
                      {latestMsg.status === 'completed'
                        ? '字幕已保存，可进行下一步总结'
                        : latestMsg.status === 'failed'
                          ? '请检查网络连接后重试'
                          : latestMsg.message || ''}
                    </p>
                  </div>
                </div>

                {latestMsg.error && (
                  <p className="mt-3 text-xs text-red-500 flex items-center gap-1.5">
                    <AlertCircle size={12} />
                    {latestMsg.error}
                  </p>
                )}
              </div>

              {/* Message history — scrollable list */}
              {messages.length > 0 && (
                <div className="border-t border-black/5 flex-1 overflow-y-auto">
                  <div className="px-5 py-1.5 bg-[#faf9f6] border-b border-black/5 sticky top-0 z-10">
                    <span className="text-[10px] font-medium text-warm-400 uppercase tracking-wide">
                      记录 · {messages.length}
                    </span>
                  </div>
                  {messages.map((entry) => (
                    <div
                      key={entry.id}
                      className={`flex justify-center px-5 py-2 text-xs border-b border-black/[0.03]
                                 ${entry.status === 'completed' ? 'bg-green-50/30' : ''}
                                 ${entry.status === 'failed' ? 'bg-red-50/30' : ''}`}
                    >
                      <span className="text-warm-500">
                        {entry.time}　{entry.message}
                      </span>
                    </div>
                  ))}
                  <div ref={historyEndRef} />
                </div>
              )}
            </div>
          )}

          {/* Subtle hint — only when no result */}
          {!hasResult && !latestMsg && (
            <p className="mt-8 text-xs text-center text-warm-300">
              支持 B站单视频、合集、分P 链接
            </p>
          )}

          {/* slideDown animation */}
          <style>{`
            @keyframes slideDown {
              from { opacity: 0; transform: translateY(-12px); }
              to   { opacity: 1; transform: translateY(0); }
            }
            .animate-slideDown {
              animation: slideDown 0.35s ease-out;
            }
          `}</style>
        </div>
      </aside>
    )
  }

  // ========================
  // Normal mode
  // ========================
  return (
    <aside
      className="w-[28%] min-w-[300px] max-w-[420px] bg-white border-r border-black/5
                 flex flex-col shrink-0 overflow-hidden"
    >
      {/* URL input */}
      <div className="p-3 border-b border-black/5">
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNormalResolve() }}
            placeholder="粘贴 B站视频 URL..."
            className="flex-1 px-3 py-2 text-sm border border-black/10 rounded-lg
                       bg-[#f7f6f3] text-warm-900 placeholder:text-warm-300
                       hover:border-warm-300 hover:bg-white
                       focus:border-accent-400 focus:ring-2 focus:ring-accent-50
                       transition-all duration-200"
          />
          <button
            onClick={handleNormalResolve}
            disabled={loadingInfo || !url.trim()}
            className="px-3 py-2 bg-warm-900 text-white text-sm font-medium rounded-lg
                       hover:bg-warm-700 active:scale-95 disabled:opacity-40
                       disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
          >
            {loadingInfo ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          </button>
        </div>
        {infoError && (
          <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
            <AlertCircle size={12} /> {infoError}
          </p>
        )}
      </div>

      {/* Video info + episode list */}
      <div className="flex-1 overflow-y-auto">
        {videoInfo ? (
          <div className="p-3">
            {/* Video metadata card */}
            <div className="mb-3 p-3 card-float bg-[#faf9f6] border border-black/5 rounded-2xl">
              <div className="flex items-center gap-2 text-sm font-medium text-warm-900 mb-1">
                <Film size={14} className="text-accent-500" />
                <span className="truncate">{videoInfo.pages?.[0]?.part || videoInfo.bvid}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-warm-400">
                <span>{videoInfo.bvid}</span>
                <span className="px-1.5 py-0.5 bg-warm-200 text-warm-600 text-[11px] font-medium rounded">
                  {videoInfo.video_type === 'single' ? '单视频' : `合集·${videoInfo.pages?.length || 0}P`}
                </span>
              </div>
            </div>

            {/* Episode selector for multi-video */}
            {videoInfo.video_type === 'multi' && videoInfo.pages?.length > 1 && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-warm-500">
                    选择分P ({selectedPages.length}/{videoInfo.pages.length})
                  </span>
                  <button
                    onClick={toggleAllPages}
                    className="text-xs text-accent-500 hover:text-accent-600 font-medium transition-colors"
                  >
                    {selectedPages.length === videoInfo.pages.length ? '取消全选' : '全选'}
                  </button>
                </div>
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {videoInfo.pages.map((page) => {
                    const isSelected = selectedPages.some((p) => p.cid === page.cid)
                    return (
                      <button
                        key={page.cid}
                        onClick={() => togglePage(page)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg
                                   transition-all duration-100
                                   ${isSelected
                                     ? 'bg-accent-50 border border-accent-200'
                                     : 'border border-transparent hover:bg-[#faf9f6]'}`}
                      >
                        <div
                          className={`w-4 h-4 border-2 flex items-center justify-center rounded
                                      shrink-0 transition-colors
                                      ${isSelected
                                        ? 'border-accent-500 bg-accent-500'
                                        : 'border-warm-300'}`}
                        >
                          {isSelected && <CheckCircle2 size={10} className="text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-warm-700 truncate">
                            P{page.page}: {page.part}
                          </p>
                        </div>
                        {page.duration && (
                          <span className="text-[10px] text-warm-400 flex items-center gap-0.5 shrink-0">
                            <Clock size={10} /> {formatDuration(page.duration)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Download button */}
            <button
              onClick={handleDownload}
              disabled={downloading || selectedPages.length === 0}
              className="w-full py-2.5 text-sm font-medium rounded-xl
                         bg-accent-500 text-white
                         hover:bg-accent-600 active:scale-[0.98]
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-all flex items-center justify-center gap-2
                         shadow-sm hover:shadow-md"
            >
              {downloading
                ? <><Loader2 size={14} className="animate-spin" /> 启动中...</>
                : <><Download size={14} /> 解析字幕 ({selectedPages.length}集)</>}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-warm-300 py-12 px-4">
            <Film size={32} strokeWidth={1} className="mb-3" />
            <p className="text-sm text-center">输入视频 URL 后即可解析</p>
          </div>
        )}
      </div>

      {/* Download progress */}
      {latestMsg && (
        <div className="p-3 border-t border-black/5 bg-[#faf9f6]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-warm-700">
              {latestMsg.status === 'completed' && '任务完成'}
              {latestMsg.status === 'failed' && '任务失败'}
              {latestMsg.status === 'processing' && (latestMsg.message || '处理中...')}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1.5 bg-warm-200 overflow-hidden rounded-full">
            <div
              className={`h-full transition-all duration-500
                ${latestMsg.status === 'completed' ? 'bg-green-500' : ''}
                ${latestMsg.status === 'failed' ? 'bg-red-500' : ''}
                ${latestMsg.status === 'processing' ? 'bg-accent-500 animate-pulse' : ''}`}
              style={{ width: latestMsg.status === 'processing' ? '60%' : '100%' }}
            />
          </div>

          {latestMsg.error && (
            <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
              <XCircle size={12} /> {latestMsg.error}
            </p>
          )}

          {latestMsg.status === 'completed' && (
            <p className="mt-1.5 text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 size={12} /> 字幕已保存，可进行下一步总结
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
