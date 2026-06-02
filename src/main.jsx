import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Apply saved theme before first paint to avoid flash
try {
  const saved = localStorage.getItem('ada-tool-theme')
  if (saved === 'dark' || saved === 'light') {
    document.documentElement.setAttribute('data-theme', saved)
  }
} catch {
  // ignore
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
