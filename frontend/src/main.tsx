import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/prose-overrides.css'
import './i18n/config'
import App from './App.tsx'

// Short share links (/g/<token>) exist so chat messages stay short. The app
// itself only knows /gallery/<token>, and several places read the address
// directly, so swap it before anything renders.
if (window.location.pathname.startsWith('/g/')) {
  window.history.replaceState(
    null,
    '',
    `/gallery/${window.location.pathname.slice(3)}${window.location.search}${window.location.hash}`
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
