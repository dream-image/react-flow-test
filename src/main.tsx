import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 取得 index.html 中的 #root 容器，创建 React 根节点并挂载整个算法 Demo。
// 非空断言 ! 表示 Vite 模板保证该元素一定存在。
createRoot(document.getElementById('root')!).render(
  // StrictMode 在开发环境帮助发现非纯渲染和副作用问题，不改变生产输出。
  <StrictMode>
    <App />
  </StrictMode>,
)
