import { useState } from 'react'
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react'

const COLORS = ['#e8794b','#5d9b6a','#6b7fba','#c4915a','#8b6b7a','#5a8a8a','#b08060','#7890a0']

export default function EpisodeList({ mindMapData, selectedEpisode, onSelectEpisode }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!mindMapData?.data || mindMapData.data.type !== 'collection') return null

  const episodes = mindMapData.data.episodes || []
  const title = mindMapData.data.title || '合集'

  // ── collapsed state ──
  if (collapsed) {
    return (
      <aside
        className="shrink-0 flex flex-col items-center border-r border-black/5 bg-white/60 backdrop-blur-sm"
        style={{ width: 30 }}
      >
        <button
          onClick={() => setCollapsed(false)}
          className="mt-3 w-6 h-6 flex items-center justify-center rounded-md
                     text-warm-400 hover:text-warm-600 hover:bg-warm-100/80 transition-all"
          title="展开选集"
        >
          <ChevronRight size={14} />
        </button>
        <div className="flex-1 flex flex-col items-center justify-center gap-1 py-3">
          {episodes.slice(0, 6).map((_, i) => (
            <span key={i} className="w-1 h-1 rounded-full bg-warm-300/60" />
          ))}
          {episodes.length > 6 && (
            <span className="text-[8px] text-warm-400 font-medium">+{episodes.length - 6}</span>
          )}
        </div>
      </aside>
    )
  }

  // ── expanded state ──
  return (
    <aside
      className="w-[165px] shrink-0 flex flex-col overflow-hidden
                 bg-white/70 backdrop-blur-sm border-r border-black/5"
    >
      {/* ── Header ── */}
      <div className="shrink-0 px-3 pt-3.5 pb-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-[11px] font-semibold text-warm-500 uppercase tracking-wider">
            选集
          </h3>
          <button
            onClick={() => setCollapsed(true)}
            className="w-5 h-5 flex items-center justify-center rounded-md
                       text-warm-400 border border-warm-200/60 hover:border-warm-300
                       hover:text-warm-600 hover:bg-warm-100 transition-all"
            title="折叠选集"
          >
            <ChevronLeft size={12} />
          </button>
        </div>
        <p className="text-[10px] text-warm-400 leading-snug line-clamp-2" title={title}>
          {title}
        </p>
      </div>

      {/* ── Divider ── */}
      <div className="mx-3 border-t border-warm-200/70" />

      {/* ── Overview ── */}
      <div className="shrink-0 px-1.5 py-1.5">
        <button onClick={() => onSelectEpisode?.(null)} className="w-full group">
          <div
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-200
                       ${selectedEpisode == null
                         ? 'bg-warm-100/80 shadow-sm'
                         : 'hover:bg-warm-50/60'}`}
          >
            <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0
                             transition-all duration-200
                             ${selectedEpisode == null
                               ? 'bg-warm-900 text-white shadow-sm'
                               : 'bg-warm-200/60 text-warm-500 group-hover:bg-warm-200'}`}>
              <Layers size={12} />
            </span>
            <span className={`text-[12px] font-semibold transition-colors
                             ${selectedEpisode == null ? 'text-warm-900' : 'text-warm-600'}`}>
              总览
            </span>
          </div>
        </button>
      </div>

      {/* ── Divider with label ── */}
      <div className="flex items-center gap-1.5 px-3 py-1 shrink-0">
        <span className="flex-1 border-t border-warm-200/50" />
        <span className="text-[9px] font-medium text-warm-400 uppercase tracking-wider">分集</span>
        <span className="flex-1 border-t border-warm-200/50" />
      </div>

      {/* ── Episode list ── */}
      <div className="flex-1 overflow-y-auto px-1.5 pb-1.5">
        {episodes.map((ep, i) => {
          const color = COLORS[i % COLORS.length]
          const isSel = selectedEpisode === i
          const pMatch = ep.title?.match(/^P(\d+)/)
          const epNum = pMatch ? pMatch[1] : i + 1
          const epLabel = ep.title?.replace(/^P\d+[:：]\s*/, '') || ep.title || `第 ${i + 1} 集`

          return (
            <button
              key={i}
              onClick={() => onSelectEpisode?.(i)}
              className="w-full group mt-px"
            >
              <div
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-200
                           hover:bg-warm-50/60"
                style={isSel ? {
                  backgroundColor: `${color}14`,
                  boxShadow: `inset 3px 0 0 ${color}`,
                } : {}}
              >
                {/* Number badge */}
                <span
                  className="w-5 h-5 rounded-[5px] flex items-center justify-center shrink-0
                             text-[9px] font-bold tabular-nums transition-all duration-200 shadow-sm"
                  style={isSel ? {
                    backgroundColor: color,
                    color: '#fff',
                  } : {
                    backgroundColor: `${color}1a`,
                    color: color,
                  }}
                >
                  {epNum}
                </span>

                {/* Title */}
                <span
                  className={`flex-1 min-w-0 text-left text-[11px] transition-colors duration-200
                             line-clamp-2 leading-snug
                             ${isSel ? 'text-warm-900 font-semibold' : 'text-warm-600 font-medium group-hover:text-warm-800'}`}
                >
                  {epLabel}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 px-3 py-2 border-t border-warm-100/80 bg-warm-50/50">
        <span className="text-[10px] text-warm-400 font-medium tabular-nums">{episodes.length} 集</span>
      </div>
    </aside>
  )
}
