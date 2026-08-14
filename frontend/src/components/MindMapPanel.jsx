import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import {
  GitBranch, ZoomIn, ZoomOut, X,
  Loader2, AlertCircle, ChevronRight, BookOpen,
  ExternalLink,
} from 'lucide-react'

// ── helpers ──

function estWidth(text, fs = 13) {
  let w = 0
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    w += ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) ||
           (c >= 0xF900 && c <= 0xFAFF) || (c >= 0x3000 && c <= 0x303F) ||
           (c >= 0xFF00 && c <= 0xFFEF)) ? fs : fs * 0.56
  }
  return Math.max(w, 40)
}

function truncLabel(text, maxW, fs = 13) {
  if (estWidth(text, fs) <= maxW) return text
  let t = ''
  for (const ch of text) { if (estWidth(t + ch + '…', fs) > maxW) break; t += ch }
  return t + '…'
}

// ── colors ──
const COLORS = ['#e8794b','#5d9b6a','#6b7fba','#c4915a','#8b6b7a','#5a8a8a','#b08060','#7890a0']
function bc(i) { return COLORS[i % COLORS.length] }
function lighten(hex, f = 0.65) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgb(${Math.round(r+(255-r)*f)},${Math.round(g+(255-g)*f)},${Math.round(b+(255-b)*f)})`
}

// ── layout ──

const COL_GAP = 180
const ROW_H   = 52

const NODE = {
  r:  { fs:15, fw:700, px:24, py:16, minW:160, h:56, rx:14 },
  l1: { fs:13, fw:600, px:20, py:12, minW:130, h:44, rx:10 },
  l2: { fs:12, fw:500, px:16, py:10, minW:110, h:36, rx:8 },
  l3: { fs:11, fw:400, px:14, py:8,  minW:90,  h:30, rx:7 },
}

function countLeaves(n) {
  if (!n.children?.length) return 1
  return n.children.reduce((s, c) => s + countLeaves(c), 0)
}

function nodeW(label, spec) {
  return Math.max(spec.minW, estWidth(label, spec.fs) + spec.px * 2)
}

function getSpec(depth) {
  if (depth === 0) return NODE.r
  if (depth === 1) return NODE.l1
  if (depth === 2) return NODE.l2
  return NODE.l3
}

// Returns the id of the newly added node
function layoutTree(node, depth, x, y, availH, nodes, links, branchIdx) {
  const spec = getSpec(depth)
  const w = nodeW(node.label || '', spec)
  const ny = y + (availH - spec.h) / 2
  const id = `n${nodes.length}`

  nodes.push({
    id, label: node.label || '', description: node.description || '',
    x, y: ny, w, h: spec.h, depth, branchIdx,
  })

  const children = node.children
  if (children?.length) {
    const childX = x + w + COL_GAP
    const totalLeaves = children.reduce((s, c) => s + countLeaves(c), 0)
    let cy = y
    children.forEach((child, i) => {
      const cl = countLeaves(child)
      const ch = Math.max((cl / totalLeaves) * availH, ROW_H * cl)
      const cb = depth === 0 ? i : branchIdx
      const childId = layoutTree(child, depth + 1, childX, cy, ch, nodes, links, cb)
      links.push({ from: id, to: childId, branchIdx: cb })
      cy += ch
    })
  }

  return id  // ← return own id so parent can link correctly
}

// ── bezier ──
function curve(sx, sy, tx, ty) {
  const dx = tx - sx
  if (dx < 1) return `M ${sx} ${sy} L ${tx} ${ty}`
  return `M ${sx} ${sy} C ${sx + dx * 0.5} ${sy}, ${tx - dx * 0.2} ${ty}, ${tx} ${ty}`
}

// ── SVG ──
function MindMapSVG({ rootNode, selectedId, onSelect, hoveredId, setHoveredId }) {
  const { nodes, links } = useMemo(() => {
    if (!rootNode) return { nodes: [], links: [] }
    const n = [], l = []
    layoutTree(rootNode, 0, 40, 40, Math.max(countLeaves(rootNode) * ROW_H, 400), n, l, -1)
    return { nodes: n, links: l }
  }, [rootNode])

  const bounds = useMemo(() => {
    if (!nodes.length) return { w: 900, h: 500 }
    let mx = 0, my = 0
    nodes.forEach(n => { mx = Math.max(mx, n.x + n.w + 80); my = Math.max(my, n.y + n.h + 80) })
    return { w: Math.max(mx, 600), h: Math.max(my, 400) }
  }, [nodes])

  if (!nodes.length) return <div className="flex items-center justify-center h-full text-warm-400 text-sm">暂无数据</div>

  const map = {}
  nodes.forEach(n => { map[n.id] = n })

  return (
    <svg viewBox={`0 0 ${bounds.w} ${bounds.h}`} className="w-full h-full" xmlns="http://www.w3.org/2000/svg"
      textRendering="optimizeLegibility" shapeRendering="geometricPrecision"
      onClick={(e) => { if (e.target === e.currentTarget) onSelect(null) }}>
      <defs>
        <filter id="s1" x="-15%" y="-10%" width="140%" height="150%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.07"/>
          <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#000" floodOpacity="0.06"/>
        </filter>
        <filter id="s2" x="-15%" y="-10%" width="140%" height="150%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.05"/>
        </filter>
      </defs>

      {/* links */}
      {links.map((l, i) => {
        const f = map[l.from], t = map[l.to]
        if (!f || !t) return null
        const c = bc(l.branchIdx)
        const sel = selectedId === l.to || selectedId === l.from
        const hov = hoveredId === l.to || hoveredId === l.from
        const sw = f.depth === 0 ? 3.5 : f.depth === 1 ? 2.5 : 1.5
        return (
          <path key={`lk-${i}`} d={curve(f.x + f.w, f.y + f.h / 2, t.x, t.y + t.h / 2)}
            fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round"
            opacity={sel ? 1 : hov ? 0.85 : (selectedId ? 0.18 : 0.5)}
            className="transition-all duration-200"/>
        )
      })}

      {/* nodes */}
      {nodes.map(n => {
        const spec = getSpec(n.depth)
        const isSel = selectedId === n.id
        const isDim = selectedId && selectedId !== n.id && hoveredId !== n.id
        const c = n.branchIdx >= 0 ? bc(n.branchIdx) : null
        const lbl = truncLabel(n.label, n.w - spec.px * 2, spec.fs)

        let bg, st, tf, hasCard = true
        if (n.depth === 0) { bg = '#1c1917'; st = '#1c1917'; tf = '#ffffff' }
        else if (n.depth === 1) { bg = c; st = c; tf = '#ffffff' }
        else if (isSel) { bg = lighten(c, 0.75); st = c; tf = '#292524' }
        else if (n.depth === 2) { bg = '#ffffff'; st = c || '#d4d0c9'; tf = '#292524' }
        else { bg = '#faf9f6'; st = c ? lighten(c, 0.5) : '#e8e5e0'; tf = '#44403c' }

        return (
          <g key={n.id} onMouseEnter={() => setHoveredId(n.id)} onMouseLeave={() => setHoveredId(null)}
            onClick={(e) => { e.stopPropagation(); onSelect(n) }}
            className="cursor-pointer" style={{ opacity: isDim ? 0.3 : 1, transition: 'opacity 0.2s' }}>
            {/* selection glow */}
            {isSel && (
              <rect x={n.x - 4} y={n.y - 4} width={n.w + 8} height={n.h + 8}
                rx={spec.rx + 2} ry={spec.rx + 2} fill="none" stroke={c || '#1c1917'} strokeWidth={2} opacity={0.3}/>
            )}
            {/* card */}
            <rect x={n.x} y={n.y} width={n.w} height={n.h}
              rx={spec.rx} ry={spec.rx} fill={bg} stroke={st}
              strokeWidth={n.depth <= 1 ? 0 : 1.2}
              filter={n.depth <= 1 || isSel ? 'url(#s1)' : 'url(#s2)'}/>
            {/* left accent bar for depth >= 2 */}
            {n.depth >= 2 && c && (
              <rect x={n.x} y={n.y + 4} width={3} height={n.h - 8} rx={1.5} fill={c} opacity={0.6}/>
            )}
            {/* label */}
            <text x={n.x + n.w / 2} y={n.y + n.h / 2 + spec.fs * 0.35}
              textAnchor="middle" fill={tf} fontSize={spec.fs} fontWeight={spec.fw}
              fontFamily="Inter, system-ui, sans-serif">{lbl}</text>
            {/* description dot */}
            {n.description && !isSel && n.depth >= 1 && (
              <circle cx={n.x + n.w - 8} cy={n.y + 8} r={3} fill={c || '#a8a39b'} opacity={0.45}/>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ── description panel ──
function DescPanel({ node, onClose }) {
  if (!node) return null
  const c = node.branchIdx >= 0 ? bc(node.branchIdx) : '#1c1917'
  const has = node.description && node.description.trim().length > 0
  return (
    <div className="absolute inset-x-4 bottom-4 bg-white rounded-2xl shadow-2xl border border-black/5 animate-slideUp flex flex-col z-10"
      style={{ maxHeight: '45%' }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3 px-5 py-3 rounded-t-2xl shrink-0 border-b border-black/5"
        style={{ backgroundColor: lighten(c, 0.85) }}>
        <div className="w-1.5 h-5 rounded-full shrink-0" style={{ backgroundColor: c }}/>
        <BookOpen size={15} style={{ color: c }} className="shrink-0"/>
        <h3 className="text-sm font-semibold flex-1 min-w-0" style={{ color: c }}>{node.label}</h3>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 transition-colors shrink-0" style={{ color: c }}>
          <X size={15}/>
        </button>
      </div>
      <div className="px-5 py-4 overflow-y-auto flex-1">
        {has ? (
          <p className="text-sm text-warm-700 leading-relaxed whitespace-pre-line">{node.description}</p>
        ) : (
          <div>
            <p className="text-sm text-warm-400 italic">该节点暂无详细说明</p>
            <details className="mt-3">
              <summary className="text-xs text-warm-300 cursor-pointer">调试</summary>
              <pre className="mt-2 text-xs text-warm-400 bg-warm-50 p-2 rounded-lg overflow-x-auto max-h-32">
                {JSON.stringify({ id: node.id, label: node.label, depth: node.depth, hasDesc: !!node.description, descLen: (node.description||'').length }, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════
// Main
// ══════════════════════════

export default function MindMapPanel({
  selectedTask, showMindMap, mindMapData, mindMapLoading,
  selectedEpisode, onViewMindMap, onCloseMindMap,
}) {
  const [zoom, setZoom] = useState(1)
  const [selectedNode, setSelectedNode] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)

  // refs for direct DOM manipulation (avoid React re-render on every mousemove)
  const panRef = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const contentRef = useRef(null)   // the transformable div
  const containerRef = useRef(null)
  const dragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  // Apply transform directly to DOM — bypasses React
  const applyTransform = useCallback((px, py, z) => {
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${px}px, ${py}px) scale(${z})`
    }
  }, [])

  // wheel → zoom (centered on cursor), applied directly to DOM
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const oldZ = zoomRef.current
    const delta = e.deltaY > 0 ? -0.08 : 0.08
    const newZ = Math.min(3, Math.max(0.25, oldZ + delta))
    const scale = newZ / oldZ
    panRef.current = {
      x: mx - scale * (mx - panRef.current.x),
      y: my - scale * (my - panRef.current.y),
    }
    zoomRef.current = newZ
    applyTransform(panRef.current.x, panRef.current.y, newZ)
    setZoom(newZ) // sync toolbar display
  }, [applyTransform])

  // Attach wheel listener natively — React's onWheel is passive, preventDefault fails
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // mouse drag → pan, applied directly to DOM
  const handleMouseDown = useCallback((e) => {
    if (e.target === containerRef.current || e.target.tagName === 'svg' || e.target === contentRef.current) {
      dragging.current = true
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }
  }, [])
  const handleMouseMove = useCallback((e) => {
    if (!dragging.current) return
    panRef.current = {
      x: panRef.current.x + (e.clientX - lastMouse.current.x),
      y: panRef.current.y + (e.clientY - lastMouse.current.y),
    }
    lastMouse.current = { x: e.clientX, y: e.clientY }
    applyTransform(panRef.current.x, panRef.current.y, zoomRef.current)
  }, [applyTransform])
  const handleMouseUp = useCallback(() => {
    if (dragging.current) {
      dragging.current = false
      setZoom(zoomRef.current) // sync toolbar
    }
  }, [])

  // toolbar zoom buttons — update both ref + DOM + state
  const zoomIn = useCallback(() => {
    const z = Math.min(3, zoomRef.current + 0.1)
    zoomRef.current = z
    applyTransform(panRef.current.x, panRef.current.y, z)
    setZoom(z)
  }, [applyTransform])
  const zoomOut = useCallback(() => {
    const z = Math.max(0.25, zoomRef.current - 0.1)
    zoomRef.current = z
    applyTransform(panRef.current.x, panRef.current.y, z)
    setZoom(z)
  }, [applyTransform])
  const zoomReset = useCallback(() => {
    panRef.current = { x: 0, y: 0 }
    zoomRef.current = 1
    applyTransform(0, 0, 1)
    setZoom(1)
  }, [applyTransform])

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseUp])

  const rootNode = useMemo(() => {
    if (!mindMapData?.data) return null
    const d = mindMapData.data
    if (d.type === 'single' && d.root) return d.root
    if (d.type === 'collection' && d.episodes?.length > 0) {
      // Specific episode selected → show just that episode's tree
      if (selectedEpisode != null && d.episodes[selectedEpisode]?.root) {
        return d.episodes[selectedEpisode].root
      }
      // Overview → merge all episodes
      return {
        label: d.title || '合集知识总结',
        description: `共 ${d.episodes.length} 集`,
        children: d.episodes.map(ep => ({
          label: ep.title || ep.root?.label || '',
          description: ep.root?.description || '',
          children: ep.root?.children || [],
        })),
      }
    }
    return null
  }, [mindMapData, selectedEpisode])

  // Reset pan/zoom when switching episodes
  useEffect(() => {
    panRef.current = { x: 0, y: 0 }
    zoomRef.current = 1
    applyTransform(0, 0, 1)
    setZoom(1)
    setSelectedNode(null)
  }, [selectedEpisode]) // eslint-disable-line react-hooks/exhaustive-deps

  // bounds estimate for container
  const est = useMemo(() => {
    if (!rootNode) return { w: 900, h: 500 }
    const lv = countLeaves(rootNode)
    const dd = (function d(n){ return !n.children?.length?0:1+Math.max(...n.children.map(d)) })(rootNode)
    return { w: 120 + (dd+1)*COL_GAP + 200, h: Math.max(lv*ROW_H + 80, 400) }
  }, [rootNode])

  // ═══ full view ═══
  if (showMindMap) {
    const pageTitle = mindMapData?.data?.title || selectedTask?.videoTitle || selectedTask?.bvid || ''
    return (
      <main className="flex-1 flex flex-col bg-transparent overflow-hidden">
        {/* toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-black/5 bg-white shrink-0">
          <div className="flex items-center gap-2 text-xs text-warm-400 min-w-0">
            <GitBranch size={14} className="shrink-0"/>
            <span className="shrink-0">知识框架图</span>
            <span className="text-warm-200 shrink-0">|</span>
            <span className="text-warm-500 font-medium truncate" title={pageTitle}>{pageTitle}</span>
            {mindMapData?.data?.source_url && (<>
              <span className="text-warm-200 shrink-0">|</span>
              <a href={mindMapData.data.source_url} target="_blank" rel="noopener noreferrer"
                 title="跳转到视频页面"
                 className="shrink-0 flex items-center gap-1 text-warm-400 hover:text-blue-600 transition-colors">
                <ExternalLink size={13}/>
                <span>打开视频</span>
              </a>
            </>)}
            {selectedNode && <><span className="text-warm-200 shrink-0">|</span><span className="text-warm-600 font-medium truncate">已选: {selectedNode.label}</span></>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={zoomOut}
              className="w-7 h-7 flex items-center justify-center rounded-xl text-warm-400 hover:text-warm-600 hover:bg-warm-100 transition-colors" title="缩小">
              <ZoomOut size={14}/></button>
            <span className="text-xs text-warm-400 w-10 text-center select-none tabular-nums">{Math.round(zoom*100)}%</span>
            <button onClick={zoomIn}
              className="w-7 h-7 flex items-center justify-center rounded-xl text-warm-400 hover:text-warm-600 hover:bg-warm-100 transition-colors" title="放大">
              <ZoomIn size={14}/></button>
            <div className="w-px h-4 bg-warm-200 mx-1"/>
            <button onClick={zoomReset}
              className="w-7 h-7 flex items-center justify-center rounded-xl text-warm-400 hover:text-warm-600 hover:bg-warm-100 transition-colors" title="重置">
              <span className="text-[10px] font-bold">1:1</span></button>
            <div className="w-px h-4 bg-warm-200 mx-1"/>
            <button onClick={onCloseMindMap}
              className="w-7 h-7 flex items-center justify-center rounded-xl text-warm-400 hover:text-warm-600 hover:bg-warm-100 transition-colors" title="关闭">
              <X size={14}/></button>
          </div>
        </div>

        {/* mind map area */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[#faf9f6]/60"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          style={{ cursor: dragging.current ? 'grabbing' : 'grab' }}>

          {mindMapLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-20 bg-[#faf9f6]/80">
              <div className="text-center"><Loader2 size={32} className="animate-spin text-warm-400 mx-auto mb-3"/>
                <p className="text-sm text-warm-500">正在加载知识框架图…</p></div>
            </div>)}

          {!mindMapLoading && !rootNode && (
            <div className="absolute inset-0 flex items-center justify-center z-20">
              <div className="text-center px-8 max-w-sm">
                <div className="w-14 h-14 mx-auto mb-4 bg-red-50 rounded-2xl flex items-center justify-center"><AlertCircle size={24} className="text-red-400"/></div>
                <p className="text-sm font-medium text-warm-700 mb-1.5">数据加载失败</p>
                <p className="text-xs text-warm-400 mb-5">Agent 可能尚未完成总结，或数据格式有误</p>
                <button onClick={() => onViewMindMap(selectedTask?.bvid_uid)}
                  className="px-5 py-2.5 bg-warm-900 text-white text-sm font-medium rounded-xl shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all">重新加载</button>
              </div>
            </div>)}

          {!mindMapLoading && rootNode && (
            <div ref={contentRef} className="absolute inset-0 flex items-center justify-center"
              style={{ transformOrigin: '0 0', transform: 'translate(0px, 0px) scale(1)' }}>
              <div style={{ width: est.w, height: est.h }}>
                <MindMapSVG rootNode={rootNode} selectedId={selectedNode?.id||null} onSelect={setSelectedNode}
                  hoveredId={hoveredId} setHoveredId={setHoveredId}/>
              </div>
            </div>
          )}

          {selectedNode && rootNode && (
            <DescPanel node={selectedNode} onClose={() => setSelectedNode(null)}/>
          )}
        </div>

        <style>{`@keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}.animate-slideUp{animation:slideUp .25s ease-out}`}</style>
      </main>
    )
  }

  // ═══ placeholder ═══
  if (!selectedTask) return <div className="flex-1 bg-transparent"/>

  return (
    <div className="flex-1 flex items-center justify-center bg-transparent">
      <div className="text-center px-8 max-w-sm">
        <div className="w-16 h-16 mx-auto mb-5 bg-white card-float flex items-center justify-center rounded-2xl">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#a8a39b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
            <line x1="10.7" y1="6.7" x2="6.3" y2="17.3"/><line x1="13.3" y1="6.7" x2="17.7" y2="17.3"/><line x1="7" y1="19" x2="17" y2="19"/>
          </svg>
        </div>
        {selectedTask.status === 'completed' ? (<>
          <p className="text-sm font-medium text-warm-700 mb-1.5">任务已完成</p>
          <p className="text-xs text-warm-400 mb-5">点击下方按钮查看 AI 生成的知识框架图</p>
          <button onClick={() => onViewMindMap(selectedTask.bvid_uid)} disabled={mindMapLoading}
            className="px-5 py-2.5 bg-warm-900 text-white text-sm font-medium rounded-xl shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2">
            {mindMapLoading ? <><Loader2 size={14} className="animate-spin"/>加载中…</> : <><ChevronRight size={14}/>查看知识框架图</>}
          </button>
        </>) : selectedTask.status === 'failed' ? (<>
          <p className="text-sm font-medium text-red-600 mb-1.5">任务失败</p>
          <p className="text-xs text-warm-400">无法生成知识框架图，请重试</p>
        </>) : (<>
          <p className="text-sm font-medium text-warm-500 mb-1.5">任务进行中</p>
          <p className="text-xs text-warm-400">等待字幕解析完成后，即可查看知识框架图</p>
        </>)}
      </div>
    </div>
  )
}
