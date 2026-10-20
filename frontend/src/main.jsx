import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import DeviceFrame from './components/DeviceFrame.jsx'
import { GameProvider } from './store.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <GameProvider>
        <DeviceFrame>
          <App />
        </DeviceFrame>
      </GameProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
