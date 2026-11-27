import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/readex-pro/400.css'
import '@fontsource/readex-pro/500.css'
import '@fontsource/readex-pro/600.css'
import '@fontsource/readex-pro/700.css'
import '@/core/theme/fonts.css'
import '@/core/theme/tokens.css'
import '@/core/theme/app.css'
// The design-system layer restyles app.css's shared components (see its header).
import '@/core/theme/design-system.css'
import '@/core/theme/portal.css'
// The design system: tokens and shared components, loaded last (docs/design/admin-rationale.md).
import '@/core/theme/system.css'
import { App } from '@/app/App'

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
