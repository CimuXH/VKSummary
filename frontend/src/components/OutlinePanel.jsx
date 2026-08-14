import { ListTree, X, BookOpen } from 'lucide-react'

// 把树形结构拍平成带深度的列表
function flatten(node, depth = 0, acc = []) {
  if (!node) return acc
  acc.push({ label: node.label || '', description: node.description || '', depth })
  node.children?.forEach((c) => flatten(c, depth + 1, acc))
  return acc
}

export default function OutlinePanel({ mindMapData, selectedEpisode, onClose }) {
  const d = mindMapData?.data
  if (!d) return null

  // 与思维导图保持一致：合集选中某集时只展示该集，否则按集分区展示
  let sections = []
  if (d.type === 'single' && d.root) {
    sections = [{ title: null, root: d.root }]
  } else if (d.type === 'collection' && d.episodes?.length > 0) {
    if (selectedEpisode != null && d.episodes[selectedEpisode]) {
      sections = [{ title: null, root: d.episodes[selectedEpisode].root }]
    } else {
      sections = d.episodes.map((ep) => ({ title: ep.title || '', root: ep.root }))
    }
  }

  const totalNodes = sections.reduce((s, sec) => s + flatten(sec.root).length, 0)

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-[280px] bg-white border-l border-black/5 shadow-2xl flex flex-col animate-slideInRight">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-black/5 shrink-0">
        <ListTree size={15} className="text-warm-400 shrink-0" />
        <h2 className="text-sm font-semibold text-warm-900 flex-1">节点导航</h2>
        <span className="text-[10px] text-warm-300 shrink-0">{totalNodes} 个节点</span>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg
                     text-warm-400 hover:text-warm-700 hover:bg-warm-100 transition-colors shrink-0"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sections.map((sec, i) => (
          <div key={i} className="mb-2">
            {sec.title && (
              <div className="px-2 py-1.5 text-xs font-medium text-warm-500 bg-[#faf9f6] rounded-lg mb-1 flex items-center gap-1.5">
                <BookOpen size={11} className="shrink-0" />
                <span className="truncate">{sec.title}</span>
              </div>
            )}
            {flatten(sec.root).map((n, j) => (
              <div
                key={j}
                title={n.description || n.label}
                style={{ paddingLeft: 10 + n.depth * 14 }}
                className="py-1 pr-2 flex items-center gap-1.5 rounded-lg hover:bg-warm-50 transition-colors"
              >
                <span className={`w-1 h-1 rounded-full shrink-0 ${n.depth === 0 ? 'bg-warm-900' : 'bg-warm-300'}`} />
                <span className={`text-xs truncate ${n.depth === 0 ? 'font-semibold text-warm-900' : 'text-warm-600'}`}>
                  {n.label || '（未命名节点）'}
                </span>
              </div>
            ))}
          </div>
        ))}
        {sections.length === 0 && (
          <p className="text-xs text-warm-400 text-center py-8">暂无节点数据</p>
        )}
      </div>

      <style>{`@keyframes slideInRight{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}.animate-slideInRight{animation:slideInRight .25s ease-out}`}</style>
    </aside>
  )
}
