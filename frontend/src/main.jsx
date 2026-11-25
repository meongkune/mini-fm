import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import DeviceFrame from './components/DeviceFrame.jsx'
import CloudGate from './components/CloudGate.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <CloudGate>
        <DeviceFrame>
          <App />
        </DeviceFrame>
      </CloudGate>
    </BrowserRouter>
  </React.StrictMode>,
)
