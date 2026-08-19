import { createRoot } from 'react-dom/client'
import ChatPanel from '../components/ChatPanel'

export function initChatFeature() {
  // 1. 找到右上角 Chat 按钮
  const chatButton = document.querySelector('button[title*="AI 对话"]')
  if (!chatButton) return

  // 2. 找到主内容区域（TopBar 下方、TaskSidebar 所在的容器）
  const main = document.querySelector('.flex-1.flex.overflow-hidden')
  if (!main) return

  // 3. 让主内容区域作为定位父级
  main.style.position = 'relative'

  // 4. 创建一个覆盖层，用来挂载聊天面板
  const host = document.createElement('div')
  host.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 40;
  `
  main.appendChild(host)

  const root = createRoot(host)
  let open = false

  const render = () => {
    root.render(
      <ChatPanel
        open={open}
        onClose={() => {
          open = false
          render()
        }}
        host={host}
      />
    )
  }

  // 5. 激活按钮
  chatButton.classList.remove('cursor-not-allowed')
  chatButton.classList.add('cursor-pointer')
  chatButton.title = 'AI 对话'
  chatButton.addEventListener('click', () => {
    open = !open
    render()
  })

  render()
}

// 等待 React 渲染完成后自动初始化
function start() {
  if (document.querySelector('.flex-1.flex.overflow-hidden')) {
    initChatFeature()
  } else {
    setTimeout(start, 200)
  }
}

start()
