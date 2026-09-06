import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installGlobalErrorCapture } from './scaffold/reportLog.ts'

// Script errors and unhandled rejections never reach a component, so catch them
// here — they are the detail a problem report is otherwise missing.
installGlobalErrorCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register service worker for cache busting and push notifications
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
}
