import { MessageCircle } from 'lucide-react'
import logoSvg from '../assets/vksummary_logo_v2.svg'

export default function TopBar({ envConfigured, onEnvClick, onLogoClick }) {
  return (
    <header
      className="h-[7%] min-h-[48px] max-h-[64px] flex items-center px-5 shrink-0
                 bg-white border-b border-black/5 shadow-sm z-10 rounded-lg"
    >
      {/* Left: env status indicator */}
      <button
        onClick={onEnvClick}
        title={envConfigured ? '环境变量已配置' : '点击配置环境变量'}
        className={`status-indicator w-8 h-8 flex items-center justify-center rounded-xl
                   shadow-sm hover:scale-105 active:scale-95 transition-transform
                   ${!envConfigured ? 'status-indicator--alert' : ''}`}
        style={{ backgroundColor: envConfigured ? '#5d9b6a' : '#e05548' }}
      >
        <span className="text-white text-xs font-semibold">
          {envConfigured ? '✓' : '!'}
        </span>
      </button>

      {/* Center: logo */}
      <div className="flex-1 flex justify-center items-center">
        <button onClick={onLogoClick} title="返回首页" className="cursor-pointer">
          <img src={logoSvg} alt="VKSummary" className="h-16 max-h-full translate-y-1" />
        </button>
      </div>

      {/* Right: AI chat button */}
      <button
        title="AI 对话 — 待实现"
        className="w-8 h-8 flex items-center justify-center rounded-xl
                   bg-warm-100 border border-black/5 text-warm-400
                   hover:bg-warm-200 hover:text-warm-500
                   transition-colors cursor-not-allowed"
      >
        <MessageCircle size={16} />
      </button>
    </header>
  )
}
