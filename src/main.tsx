import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { VendorProvider } from './vendor/VendorContext'
import './styles/global.css'

// In production the app is hosted under a sub-path (e.g. /projects/app/);
// BASE_URL carries that so router paths resolve correctly. Empty in dev.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename || undefined}>
      <AuthProvider>
        <VendorProvider>
          <App />
        </VendorProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
