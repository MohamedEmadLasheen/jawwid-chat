import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/core/theme/tokens.css'
import '@/core/theme/app.css'
import { App } from '@/app/App'

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
