import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { ProvedorTema } from './lib/tema'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProvedorTema>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ProvedorTema>
  </StrictMode>,
)
