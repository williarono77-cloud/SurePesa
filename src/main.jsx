import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'
import { getToggle } from './utils/storage.js'

// Initialize theme on app load
const savedTheme = getToggle('theme')
if (savedTheme === 'light') {
  document.documentElement.classList.add('light-mode')
} else {
  document.documentElement.classList.remove('light-mode')
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
