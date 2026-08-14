import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Layers, XCircle, Loader2, BookOpen, X, AlertTriangle,
  ListTree, ChevronsRight, ChevronsLeft, Settings2, Check,
} from 'lucide-react'

export default function TaskSidebar({
  liveTasks, completedTasks,
  selectedTaskId, onSelectTask, onSelectHistory, onDismissTask, onDeleteTasks,
  outlineEnabled, onToggleOutline,
}) {
  const [expanded, setExpanded] = useState(false)
  // 管理模式：勾选要删除的任务
  const [managing, setManaging] = useState(false)
  const [selectedForDelete, setSelectedForDelete] = useState([])
  const [confirming, setConfirming] = useState(false)

  const activeLive = liveTasks.filter(t => t.status !== 'completed')
  const filteredLive = activeLive.filter(t => !completedTasks.some(c => c.bvid_uid === t.bvid_uid))
  const allEmpty = completedTasks.length === 0 && filteredLive.length === 0

  const toggleSelect = (bvidUid) => {
    setConfirming(false)
    setSelectedForDelete((prev) =>
      prev.includes(bvidUid) ? prev.filter((u) => u !== bvidUid) : [...prev, bvidUid]
    )
  }

  const exitManaging = () => {
    setManaging(false)
    setSelectedForDelete([])
    setConfirming(false)
  }

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true)   // 第一次点击 → 进入确认状态
      return
    }
    await onDeleteTasks(selectedForDelete)
    exitManaging()
  }

  // ═══ 展开模式：直接展示每个任务对应的内容标题，不用悬停 ═══
  if (expanded) {
    return (
      <aside className="w-[230px] min-w-[190px] bg-white border-r border-black/5 rounded-lg
                         flex flex-col shrink-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-black/5 shrink-0">
          <span className="text-xs font-semibold text-warm-700">
            {managing ? `已选 ${selectedForDelete.length} 个任务` : '任务列表'}
          </span>
          <div className="flex items-center gap-0.5">
            {managing ? (
              <button
                onClick={exitManaging}
                className="px-2 h-7 flex items-center rounded-lg text-xs text-warm-500 hover:bg-warm-100 transition-colors"
              >
                完成
              </button>
            ) : (
              <>
                <button
                  onClick={() => setManaging(true)}
                  title="管理任务（选择要删除的任务）"
                  className="px-2 h-7 flex items-center gap-1 rounded-lg text-xs text-warm-500 hover:bg-warm-100 transition-colors"
                >
                  <Settings2 size={13} /> 管理
                </button>
                <button
                  onClick={() => setExpanded(false)}
                  title="收起任务列表"
                  className="w-7 h-7 flex items-center justify-center rounded-lg
                             text-warm-400 hover:text-warm-700 hover:bg-warm-100 transition-colors"
                >
                  <ChevronsLeft size={16} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-1.5">
          {allEmpty && <p className="text-xs text-warm-300 text-center py-8">暂无任务</p>}

          {completedTasks.length > 0 && (
            <p className="px-3 pt-1 pb-0.5 text-[10px] text-warm-300 font-medium">
              已完成 · {completedTasks.length}
            </p>
          )}
          {completedTasks.map((task) => {
            const selected = selectedForDelete.includes(task.bvid_uid)
            return (
              <button
                key={task.bvid_uid}
                onClick={managing
                  ? () => toggleSelect(task.bvid_uid)
                  : () => { onSelectTask(task.bvid_uid); onSelectHistory(task.bvid_uid) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors
                            ${!managing && task.bvid_uid === selectedTaskId ? 'bg-warm-100' : 'hover:bg-warm-50'}`}
              >
                {managing ? (
                  <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
                                   ${selected ? 'border-red-500 bg-red-500' : 'border-warm-300'}`}>
                    {selected && <Check size={10} className="text-white" />}
                  </span>
                ) : (
                  <BookOpen size={14} className="text-warm-500 shrink-0" />
                )}
                <span className="text-xs text-warm-800 truncate flex-1" title={task.title || task.bvid_uid}>
                  {task.title || task.bvid_uid}
                </span>
              </button>
            )
          })}

          {completedTasks.length > 0 && filteredLive.length > 0 && (
            <div className="mx-3 my-1 h-px bg-warm-100" />
          )}

          {filteredLive.length > 0 && (
            <p className="px-3 pt-1 pb-0.5 text-[10px] text-warm-300 font-medium">
              进行中 · {filteredLive.length}
            </p>
          )}
          {filteredLive.map((task) => {
            const isFailed = task.status === 'failed' || !!task.error
            const isProcessing = task.status === 'processing'
            const selected = selectedForDelete.includes(task.bvid_uid)

            let Icon = Layers, colorClass = 'text-warm-300'
            if (isFailed) { Icon = XCircle; colorClass = 'text-red-500' }
            else if (isProcessing) { Icon = Loader2; colorClass = 'text-blue-500 animate-spin' }

            // 管理模式：只有失败的任务可选，处理中的置灰不可点
            if (managing && !isFailed) {
              return (
                <button
                  key={task.bvid_uid}
                  disabled
                  className="w-full flex items-center gap-2 px-3 py-2 text-left opacity-40"
                >
                  <Icon size={14} className={`${colorClass} shrink-0`} />
                  <span className="text-xs text-warm-800 truncate flex-1">
                    {task.videoTitle || task.bvid || '未知任务'}
                  </span>
                </button>
              )
            }

            return (
              <button
                key={task.bvid_uid}
                onClick={managing ? () => toggleSelect(task.bvid_uid) : () => onSelectTask(task.bvid_uid)}
                className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors
                            ${!managing && task.bvid_uid === selectedTaskId ? 'bg-warm-100' : 'hover:bg-warm-50'}`}
              >
                {managing ? (
                  <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors mt-0.5
                                   ${selected ? 'border-red-500 bg-red-500' : 'border-warm-300'}`}>
                    {selected && <Check size={10} className="text-white" />}
                  </span>
                ) : (
                  <Icon size={14} className={`${colorClass} shrink-0 mt-0.5`} />
                )}
                <span className="text-xs text-warm-800 flex-1 min-w-0">
                  <span className="block truncate">{task.videoTitle || task.bvid || '未知任务'}</span>
                  {isFailed && (
                    <span className="block text-[10px] text-red-500 truncate mt-0.5">
                      {task.error || task.message || '任务失败'}
                    </span>
                  )}
                </span>
                {!managing && isFailed && (
                  <span
                    role="button"
                    title="删除此错误"
                    onClick={(e) => { e.stopPropagation(); onDismissTask?.(task.bvid_uid) }}
                    className="w-5 h-5 flex items-center justify-center rounded
                               hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors shrink-0"
                  >
                    <X size={12} />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* 底部：管理模式显示删除操作，否则显示节点导航 */}
        {managing ? (
          <div className="border-t border-black/5 p-2 shrink-0 flex gap-2">
            <button
              onClick={exitManaging}
              className="flex-1 py-2 rounded-xl text-xs font-medium text-warm-600
                         hover:bg-warm-100 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleDelete}
              disabled={selectedForDelete.length === 0}
              className={`flex-1 py-2 rounded-xl text-xs font-medium text-white transition-colors
                          disabled:opacity-40 disabled:cursor-not-allowed
                          ${confirming ? 'bg-red-600 hover:bg-red-700' : 'bg-red-500 hover:bg-red-600'}`}
            >
              {confirming ? `确认删除 ${selectedForDelete.length} 个任务?` : `删除选中 (${selectedForDelete.length})`}
            </button>
          </div>
        ) : (
          <div className="border-t border-black/5 p-2 shrink-0">
            <button
              onClick={onToggleOutline}
              disabled={!outlineEnabled}
              title={outlineEnabled ? '打开节点导航' : '加载思维导图后可查看节点导航'}
              className={`w-full py-2 flex items-center justify-center gap-1.5 rounded-xl text-xs font-medium transition-colors
                          ${outlineEnabled
                            ? 'text-warm-600 hover:bg-warm-100'
                            : 'text-warm-200 cursor-not-allowed'}`}
            >
              <ListTree size={14} /> 节点导航
            </button>
          </div>
        )}
      </aside>
    )
  }

  // ═══ 收起模式：图标窄栏 ═══
  if (allEmpty) {
    return (
      <aside className="w-[5%] min-w-[52px] max-w-[64px] bg-white border-r border-black/5 rounded-lg
                         flex flex-col items-center py-1.5 gap-2 shrink-0">
        <button
          onClick={() => setExpanded(true)}
          title="展开任务列表"
          className="w-9 h-9 flex items-center justify-center rounded-xl
                     text-warm-400 hover:bg-warm-50 hover:text-warm-600 transition-colors"
        >
          <ChevronsRight size={16} />
        </button>
        <div className="text-warm-300 text-[10px] text-center leading-tight mt-4">暂无<br />任务</div>
      </aside>
    )
  }

  return (
    <aside className="w-[5%] min-w-[52px] max-w-[64px] bg-white border-r border-black/5 rounded-lg
                       flex flex-col items-center py-1.5 gap-1.5 shrink-0">
      {/* 展开按钮 */}
      <button
        onClick={() => setExpanded(true)}
        title="展开任务列表"
        className="w-9 h-9 flex items-center justify-center rounded-xl
                   text-warm-400 hover:bg-warm-50 hover:text-warm-600 transition-colors"
      >
        <ChevronsRight size={16} />
      </button>

      {/* Completed / history tasks */}
      {completedTasks.map((task) => (
        <TaskIcon
          key={task.bvid_uid}
          task={task}
          isSelected={task.bvid_uid === selectedTaskId}
          onClick={() => { onSelectTask(task.bvid_uid); onSelectHistory(task.bvid_uid) }}
          icon={BookOpen}
          colorClass="text-warm-500"
          title={task.title || task.bvid_uid}
        />
      ))}

      {completedTasks.length > 0 && filteredLive.length > 0 && (
        <div className="w-6 h-px bg-warm-200 my-1" />
      )}

      {/* Live tasks */}
      {filteredLive.map((task) => {
        const isFailed = task.status === 'failed' || !!task.error
        const isProcessing = task.status === 'processing'

        let Icon = Layers, colorClass = 'text-warm-300'
        if (isFailed) { Icon = XCircle; colorClass = 'text-red-500' }
        else if (isProcessing) { Icon = Loader2; colorClass = 'text-blue-500 animate-spin' }

        return (
          <TaskIcon
            key={task.bvid_uid}
            task={task}
            isSelected={task.bvid_uid === selectedTaskId}
            onClick={() => onSelectTask(task.bvid_uid)}
            icon={Icon}
            colorClass={colorClass}
            title={`${task.videoTitle || task.bvid || ''} — ${task.status || 'unknown'}`}
            isFailed={isFailed}
            errorMsg={task.error || task.message}
            onDismiss={isFailed ? () => onDismissTask?.(task.bvid_uid) : undefined}
          />
        )
      })}

      {/* 节点导航开关：底部 */}
      <div className="mt-auto pt-2 border-t border-warm-100 w-full flex justify-center">
        <button
          onClick={onToggleOutline}
          disabled={!outlineEnabled}
          title={outlineEnabled ? '打开节点导航' : '加载思维导图后可查看节点导航'}
          className={`w-9 h-9 flex items-center justify-center rounded-xl transition-colors
                      ${outlineEnabled
                        ? 'text-warm-500 hover:bg-warm-100 hover:text-warm-700'
                        : 'text-warm-200 cursor-not-allowed'}`}
        >
          <ListTree size={18} />
        </button>
      </div>
    </aside>
  )
}

function TaskIcon({ task, isSelected, onClick, icon: Icon, colorClass, title, isFailed, errorMsg, onDismiss }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [showError, setShowError] = useState(false)
  const [btnRect, setBtnRect] = useState(null)
  const [hover, setHover] = useState(false)

  const handleMouseEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setBtnRect(rect)
    setShowTooltip(true)
    setHover(true)
  }
  const handleMouseLeave = () => {
    setShowTooltip(false)
    setHover(false)
  }

  const handleClick = (e) => {
    if (isFailed) {
      // Click failed task → toggle error details
      e.stopPropagation()
      setShowError(!showError)
    } else {
      onClick?.()
    }
  }

  return (
    <>
      <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <button
          onClick={handleClick}
          className={`relative w-9 h-9 flex items-center justify-center rounded-xl
                      transition-all duration-200
                      ${isSelected ? 'bg-warm-100 ring-1 ring-warm-300 shadow-sm' : 'hover:bg-warm-50 hover:shadow-sm'}`}
        >
          <Icon size={18} className={colorClass} />
        </button>

        {/* Dismiss "×" overlay — shown on hover for failed tasks */}
        {isFailed && hover && onDismiss && (
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss() }}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white
                       rounded-full flex items-center justify-center
                       hover:bg-red-600 transition-colors shadow-sm"
            title="删除此错误"
          >
            <X size={9} strokeWidth={3} />
          </button>
        )}
      </div>

      {/* Hover tooltip via portal */}
      {showTooltip && title && !showError && btnRect &&
        createPortal(
          <div
            className="fixed z-[9999] bg-warm-900 text-white text-xs font-medium
                       px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap max-w-[220px] truncate pointer-events-none"
            style={{ left: btnRect.right + 8, top: btnRect.top + btnRect.height / 2, transform: 'translateY(-50%)' }}
          >
            {title}
          </div>,
          document.body
        )}

      {/* Error details popup — shown on click for failed tasks */}
      {showError && isFailed && btnRect &&
        createPortal(
          <div
            className="fixed z-[9998] bg-white border border-red-200 rounded-xl shadow-xl w-[280px]"
            style={{ left: btnRect.right + 12, top: btnRect.top, maxHeight: '200px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-red-100 bg-red-50/50 rounded-t-xl">
              <AlertTriangle size={14} className="text-red-500 shrink-0" />
              <span className="text-xs font-semibold text-red-700 flex-1 truncate">任务失败</span>
              <button
                onClick={() => setShowError(false)}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-100 transition-colors shrink-0"
              >
                <X size={12} className="text-red-400" />
              </button>
            </div>
            {/* Body */}
            <div className="px-3 py-2.5 text-xs text-red-700 leading-relaxed overflow-y-auto max-h-[140px] whitespace-pre-wrap break-all">
              {errorMsg || '未知错误'}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
