import { useState } from 'react'
import StockAnalysis from './components/StockAnalysis'
import './App.css'

function App() {
  const [theme, setTheme] = useState('dark')

  return (
    <div className="app" data-theme={theme}>
      <header className="header">
        <h1>$ stockalysis</h1>
        <p className="tagline">Professional-grade technical analysis for US markets</p>
        <button className="theme-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>
      <main className="main">
        <StockAnalysis />
      </main>
      <footer className="footer">
        <p>stockalysis <span className="footer-rev">v1.0.0</span></p>
        <p className="footer-copy">Copyrights &copy; 2026 Veera Kumar, All rights reserved. | Made with &hearts; and &#9749; by Veera Kumar</p>
      </footer>
    </div>
  )
}

export default App
