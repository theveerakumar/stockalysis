import { useState, useEffect, useCallback, useRef } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Bar, ComposedChart, Area } from 'recharts'

const POPULAR = ['AAPL','MSFT','GOOGL','AMZN','TSLA','META','NVDA','JPM','V','JNJ','WMT','PG','MA','UNH','HD','DIS','NFLX','BA','KO','PEP','AMD','INTC','CRM','ADBE','PYPL']

const AV = 'https://www.alphavantage.co/query'
const KEY = import.meta.env.VITE_ALPHA_KEY

async function fetchDaily(ticker) {
  const r = await fetch(`${AV}?function=TIME_SERIES_DAILY&symbol=${ticker}&apikey=${KEY}`)
  const j = await r.json()
  const ts = j['Time Series (Daily)']
  if (!ts) throw new Error(j.Note || 'No daily data')
  return Object.entries(ts).map(([date, v]) => ({
    date, ts: new Date(date).getTime() / 1000,
    open: +v['1. open'], high: +v['2. high'],
    low: +v['3. low'], close: +v['4. close'], volume: +v['5. volume'],
  })).reverse()
}

async function fetchWeekly(ticker) {
  const r = await fetch(`${AV}?function=TIME_SERIES_WEEKLY&symbol=${ticker}&apikey=${KEY}`)
  const j = await r.json()
  const ts = j['Weekly Time Series']
  if (!ts) throw new Error('No weekly data')
  return Object.entries(ts).map(([date, v]) => ({
    date, close: +v['4. close'], high: +v['2. high'], low: +v['3. low'],
  })).reverse()
}

function calcSMA(data, period) {
  const r = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { r.push(null); continue }
    let s = 0; for (let j = i - period + 1; j <= i; j++) s += data[j]
    r.push(s / period)
  }
  return r
}

function calcBB(data, period = 20, std = 2) {
  const sma = calcSMA(data, period)
  const upper = [], lower = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { upper.push(null); lower.push(null); continue }
    let sq = 0; for (let j = i - period + 1; j <= i; j++) sq += (data[j] - sma[i]) ** 2
    const sd = Math.sqrt(sq / period)
    upper.push(sma[i] + std * sd)
    lower.push(sma[i] - std * sd)
  }
  return { upper, mid: sma, lower }
}

function calcRSI(closes, p = 14) {
  const r = []; let g = 0, l = 0
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) g += d; else l -= d
    if (i === p) { g /= p; l /= p }
    if (i >= p) {
      const rs = l === 0 ? 100 : g / l
      r.push(100 - 100 / (1 + rs))
      const d2 = closes[i] - closes[i - 1]
      g = (g * (p - 1) + (d2 > 0 ? d2 : 0)) / p
      l = (l * (p - 1) + (d2 < 0 ? -d2 : 0)) / p
    } else r.push(null)
  }
  return r
}

function calcMACD(closes) {
  const ema12 = [], ema26 = [], macd = [], signal = [], hist = []
  const k12 = 2 / 13, k26 = 2 / 27
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { ema12.push(closes[i]); ema26.push(closes[i]); macd.push(0); signal.push(0); hist.push(0); continue }
    const e12 = closes[i] * k12 + ema12[i - 1] * (1 - k12)
    const e26 = closes[i] * k26 + ema26[i - 1] * (1 - k26)
    ema12.push(e12); ema26.push(e26)
    const m = e12 - e26; macd.push(m)
    const s = i > 0 ? m * 0.2 + (signal[i - 1] || m) * 0.8 : m
    signal.push(s); hist.push(m - s)
  }
  return { macd, signal, hist }
}

function calcADX(highs, lows, closes, p = 14) {
  const tr = [], pdm = [], mdm = [], atr = [], pdi = [], mdi = [], dx = [], adx = []
  for (let i = 1; i < highs.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
    const up = highs[i] - highs[i - 1], dn = lows[i - 1] - lows[i]
    pdm.push(up > dn && up > 0 ? up : 0)
    mdm.push(dn > up && dn > 0 ? dn : 0)
  }
  for (let i = 0; i < highs.length; i++) {
    if (i < p) { atr.push(null); pdi.push(null); mdi.push(null); dx.push(null); adx.push(null); continue }
    let at = 0, pd = 0, md = 0; for (let j = i - p; j < i; j++) { at += tr[j]; pd += pdm[j]; md += mdm[j] }
    at /= p; pd /= p; md /= p; atr.push(at); pdi.push(pd); mdi.push(md)
    const ds = pd + md; dx.push(ds > 0 ? Math.abs(pd - md) / ds * 100 : 0)
  }
  for (let i = 0; i < highs.length; i++) {
    if (i < p * 2 - 1) { adx.push(null); continue }
    let s = 0; for (let j = i - p + 1; j <= i; j++) s += dx[j] || 0
    adx.push(s / p)
  }
  return { adx, pdi, mdi }
}

function calcVolAvg(volumes) {
  const avg = volumes.reduce((a, b) => a + b, 0) / volumes.length
  const last = volumes[volumes.length - 1]
  return { avg, ratio: last / avg, level: last > avg * 1.3 ? 'high' : last < avg * 0.7 ? 'low' : 'avg' }
}

export default function StockAnalysis() {
  const [ticker, setTicker] = useState('AAPL')
  const [period, setPeriod] = useState('1y')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const searchCache = useRef(new Map())
  const searchRef = useRef(null)
  const debounceRef = useRef(null)
  const overviewCache = useRef(new Map())

  const load = useCallback(async (t, p) => {
    setLoading(true); setError(null)
    try {
      const [daily, weekly, overviewData] = await Promise.all([fetchDaily(t), fetchWeekly(t), fetchOverview(t)])
      const days = p === '1y' ? 100 : 63

      const prices = daily.slice(-days).map(d => ({
        ...d,
        dateLabel: new Date(d.ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      }))

      const c = prices.map(d => d.close), h = prices.map(d => d.high), l = prices.map(d => d.low), v = prices.map(d => d.volume)
      const wc = weekly.map(d => d.close), wh = weekly.map(d => d.high), wl = weekly.map(d => d.low)

      const sma20 = calcSMA(c, 20), sma50 = calcSMA(c, 50)
      const sma100w = calcSMA(wc, 100), sma200w = calcSMA(wc, 200)
      const bb = calcBB(c, 20, 2)
      const rsi = calcRSI(c)
      const macd = calcMACD(c)
      const adx = calcADX(h, l, c)
      const vol = calcVolAvg(v)

      const merged = prices.map((p, i) => ({
        ...p, sma20: sma20[i], sma50: sma50[i],
        bbUpper: bb.upper[i], bbLower: bb.lower[i],
        rsi: rsi[i], macd: macd.macd[i], macdSignal: macd.signal[i], macdHist: macd.hist[i],
        adx: adx.adx[i], pdi: adx.pdi[i], mdi: adx.mdi[i],
      }))

      const last = merged[merged.length - 1]
      const lc = last?.close || 0
      const lr = last?.rsi || 50
      const lm = last?.macd || 0
      const ls = last?.macdSignal || 0

      const sc = sma100w[sma100w.length - 1]
      const s2 = sma200w[sma200w.length - 1]

      const sma20v = last?.sma20
      const sma50v = last?.sma50

      let regime = 'ranging'
      const adxv = adx.adx[adx.adx.length - 1] || 0
      const pdv = adx.pdi[adx.pdi.length - 1] || 0
      const mdv = adx.mdi[adx.mdi.length - 1] || 0
      if (adxv >= 25 && pdv > mdv) regime = 'trend-up'
      if (adxv >= 25 && mdv > pdv) regime = 'trend-down'

      let trade = adxv >= 25 || regime !== 'ranging' ? 'Trend trading: buy dips in direction' : 'Range trading: buy support, sell resistance'

      let score = 50
      if (lr < 30) score += 20; else if (lr < 45) score += 10; else if (lr > 70) score -= 20; else if (lr > 60) score -= 10
      if (lm > ls) score += 15; else score -= 15
      if (regime === 'trend-up') score += 10; else if (regime === 'trend-down') score -= 10
      if (lc > s2) score += 10; else score -= 10
      if (sma20v && sma50v && sma20v > sma50v) score += 5; else score -= 5
      if (vol.level === 'high') score += 5; else if (vol.level === 'low') score -= 5

      const overall = score >= 70 ? 'Strong Buy' : score >= 55 ? 'Buy' : score >= 40 ? 'Hold' : score >= 25 ? 'Sell' : 'Strong Sell'
      const signalClass = score >= 55 ? 'buy' : score >= 40 ? 'hold' : 'sell'
      const signalClass2 = score >= 70 ? 'strong-buy' : signalClass === 'sell' && score < 25 ? 'strong-sell' : signalClass

      const lh = lc * 0.02
      const entryLow = Math.round((lc - lh) * 100) / 100
      const entryHigh = Math.round((lc * (sma20v && sma50v ? 1 : 1)) * 100) / 100
      const sl = Math.round((lc * 0.95) * 100) / 100
      const target = Math.round((lc * (score >= 55 ? 1.08 : 1.04)) * 100) / 100
      const rr = target - sl > 0 ? ((lc - sl) / (target - lc)).toFixed(1) : '—'

      const qSlice = merged.slice(-63)
      const qHi = Math.max(...qSlice.map(p => p.high).filter(Boolean))
      const qLo = Math.min(...qSlice.map(p => p.low).filter(Boolean))
      const qRet = merged.length > 63 ? ((lc / merged[merged.length - 64]?.close - 1) * 100).toFixed(1) : '—'

      const pivotH = last?.high || lc
      const pivotL = last?.low || lc
      const pivot = (pivotH + pivotL + lc) / 3
      const r1 = 2 * pivot - pivotL
      const r2 = pivot + (pivotH - pivotL)
      const s1 = 2 * pivot - pivotH
      const pivotS2 = pivot - (pivotH - pivotL)

      const rangeHigh = Math.max(...h.filter(Boolean))
      const rangeLow = Math.min(...l.filter(Boolean))
      const diff = rangeHigh - rangeLow
      const fib236 = rangeLow + diff * 0.236
      const fib382 = rangeLow + diff * 0.382
      const fib500 = rangeLow + diff * 0.5
      const fib618 = rangeLow + diff * 0.618
      const fib786 = rangeLow + diff * 0.786

      setData({
        merged, ticker: t, price: lc, close: lc,
        rsi: lr, macd: lm, macdSignal: ls, macdHist: last?.macdHist || 0,
        adx: adxv, pdi: pdv, mdi: mdv, regime, trade,
        sma20: sma20v, sma50: sma50v, sma100: sc, sma200: s2,
        bbUpper: bb.upper[bb.upper.length - 1], bbLower: bb.lower[bb.lower.length - 1],
        volume: v[v.length - 1], volAvg: vol.avg, volRatio: vol.ratio, volLevel: vol.level,
        overall, signalClass: signalClass2, conf: score,
        entryLow, entryHigh, sl, target, rr,
        qHigh: qHi, qLow: qLo, qReturn: qRet,
        change: merged.length > 1 ? ((lc / merged[merged.length - 2]?.close - 1) * 100).toFixed(2) : '0',
        overview: overviewData,
        pivot, r1, r2, s1, pivotS2,
        fib236, fib382, fib500, fib618, fib786,
      })
      setLoading(false)
    } catch (e) {
      setError(e.message); setLoading(false)
    }
  }, [])

  useEffect(() => { load(ticker, period) }, [ticker, period])

  async function fetchSearch(query) {
    const cached = searchCache.current.get(query)
    if (cached) return cached
    try {
      const r = await fetch(`${AV}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${KEY}`)
      const j = await r.json()
      if (j.Note) return []
      const matches = (j.bestMatches || []).map(m => ({
        symbol: m['1. symbol'],
        name: m['2. name'],
        region: m['4. region'],
      }))
      searchCache.current.set(query, matches)
      return matches
    } catch { return [] }
  }

  async function fetchOverview(ticker) {
    const cached = overviewCache.current.get(ticker)
    if (cached) return cached
    try {
      const r = await fetch(`${AV}?function=OVERVIEW&symbol=${ticker}&apikey=${KEY}`)
      const j = await r.json()
      if (j.Note || !j.Symbol) return null
      const data = {
        marketCap: j.MarketCapitalization,
        peRatio: j.PERatio,
        eps: j.EPS,
        dividendYield: j.DividendYield,
        beta: j.Beta,
        week52High: j['52WeekHigh'],
        week52Low: j['52WeekLow'],
        sector: j.Sector,
        industry: j.Industry,
      }
      overviewCache.current.set(ticker, data)
      return data
    } catch { return null }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (searchQuery.length < 2) {
      setSearchResults([]); setShowDropdown(false); setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const results = await fetchSearch(searchQuery)
      setSearchResults(results)
      setShowDropdown(true)
      setActiveIndex(-1)
      setSearching(false)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery])

  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selectStock = (item) => {
    setTicker(item.symbol)
    setSearchQuery('')
    setSearchResults([])
    setShowDropdown(false)
  }

  const selectPopular = (t) => {
    setTicker(t)
    setSearchQuery('')
    setSearchResults([])
    setShowDropdown(false)
  }

  const handleSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => prev < searchResults.length - 1 ? prev + 1 : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => prev > 0 ? prev - 1 : searchResults.length - 1)
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      selectStock(searchResults[activeIndex])
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    }
  }

  const fmt = (n) => n === null || n === undefined ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtInt = (n) => n === null || n === undefined ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const fmtCap = (n) => {
    if (!n) return '—'
    const v = +n
    if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T'
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
    return '$' + fmt(v)
  }

  const Ct = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (<div className="chart-tooltip"><div className="tooltip-date">{label}</div>{payload.filter(p => p.value !== null).map((p, i) => <div key={i} className="tooltip-row"><span style={{ color: p.color }}>{p.name}</span><span>{fmt(p.value)}</span></div>)}</div>)
  }

  return (
    <div className="stock-analyzer">
      <div className="stock-controls">
        <div className="search-wrapper" ref={searchRef}>
          <div className="search-input-wrap">
            <span className="search-icon">$</span>
            <input
              type="text"
              className="search-input"
              placeholder="Search stocks by name or ticker..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setShowDropdown(true) }}
              onKeyDown={handleSearchKeyDown}
            />
            {searching && <span className="search-spinner" />}
          </div>
          {showDropdown && searchResults.length > 0 && (
            <div className="search-dropdown">
              {searchResults.map((item, i) => (
                <div
                  key={item.symbol}
                  className={`search-item ${i === activeIndex ? 'active' : ''}`}
                  onClick={() => selectStock(item)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <span className="search-symbol">{item.symbol}</span>
                  <span className="search-name">{item.name}</span>
                  <span className="search-region">{item.region}</span>
                </div>
              ))}
            </div>
          )}
          {showDropdown && searchResults.length === 0 && !searching && searchQuery.length >= 2 && (
            <div className="search-dropdown">
              <div className="search-empty">No results found</div>
            </div>
          )}
          {!searchQuery && (
            <div className="popular-chips">
              {POPULAR.map(t => (
                <button
                  key={t}
                  className={`popular-chip ${ticker === t ? 'active' : ''}`}
                  onClick={() => selectPopular(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="period-group">
          {['1y','3mo'].map(p => <button key={p} className={`period-btn ${period === p ? 'active' : ''}`} onClick={() => setPeriod(p)}>{p === '1y' ? '1 Year' : 'Quarter'}</button>)}
        </div>
      </div>

      {loading && <div className="stock-loading"><div className="spinner"></div><span>Loading {ticker}...</span></div>}
      {error && <div className="stock-error">{error}. Try another ticker.</div>}

      {data && !loading && <div className="stock-layout">
        <div className="stock-main">
          <div className="stock-header">
            <span className="stock-ticker">{data.ticker}</span>
            <span className="stock-price">${fmt(data.price)}</span>
            <span className={`stock-change ${+data.change >= 0 ? 'pos' : 'neg'}`}>{+data.change >= 0 ? '▲' : '▼'} {Math.abs(data.change)}%</span>
            {data.sma200 && <span style={{ fontSize: '0.7rem', color: 'var(--text2)' }}>SMA200: ${fmt(data.sma200)}</span>}
          </div>

          <div className="chart-card">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={data.merged}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--surface3)" />
                <XAxis dataKey="dateLabel" tick={{ fill: 'var(--text2)', fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis domain={['auto', 'auto']} tick={{ fill: 'var(--text2)', fontSize: 9 }} />
                <Tooltip content={<Ct />} />
                <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text2)' }} />
                <Area type="monotone" dataKey="bbUpper" stroke="transparent" fill="var(--accent)" fillOpacity={0.04} />
                <Area type="monotone" dataKey="bbLower" stroke="transparent" fill="var(--accent)" fillOpacity={0.04} />
                <Line type="monotone" dataKey="close" stroke="var(--accent)" name="Price" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="sma20" stroke="var(--green)" name="SMA 20" dot={false} strokeWidth={1} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="sma50" stroke="var(--amber)" name="SMA 50" dot={false} strokeWidth={1} />
                <Line type="monotone" dataKey="bbUpper" stroke="var(--text2)" name="B.Band" dot={false} strokeWidth={0.5} />
                <Line type="monotone" dataKey="bbLower" stroke="var(--text2)" name="" dot={false} strokeWidth={0.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="regime-line">
            <span className={`regime-badge ${data.regime}`}>{data.regime.replace('-', ' ').toUpperCase()}</span>
            <span className="regime-strat">{data.trade}</span>
          </div>

          <div className={`signal-banner ${data.signalClass}`}>
            <span className="signal-label">SIGNAL</span>
            <span className="signal-value">{data.overall}</span>
            <span className="signal-conf">{data.conf}% confidence</span>
          </div>

          <div className="indicator-grid">
            <div className="indicator-card">
              <span className="indicator-name">RSI {fmt(data.rsi)}</span>
              <span className={`indicator-status ${data.rsi > 70 ? 'overbought' : data.rsi < 30 ? 'oversold' : 'neutral'}`}>
                {data.rsi > 70 ? 'Overbought' : data.rsi < 30 ? 'Oversold' : 'Neutral'}
              </span>
              <span className="indicator-desc">{data.rsi < 30 ? 'Oversold — potential bounce zone' : data.rsi > 70 ? 'Overbought — caution on longs' : 'Neutral range'}</span>
            </div>
            <div className="indicator-card">
              <span className="indicator-name">MACD {fmt(data.macd)}</span>
              <span className={`indicator-status ${data.macd > data.macdSignal ? 'bullish' : 'bearish'}`}>
                {data.macd > data.macdSignal ? 'Bullish' : 'Bearish'}
              </span>
              <span className="indicator-desc">{data.macd > data.macdSignal ? 'Momentum turning up' : 'Momentum fading'} | Hist: {fmt(data.macdHist)}</span>
            </div>
            <div className="indicator-card">
              <span className="indicator-name">ADX {fmt(data.adx)}</span>
              <span className={`indicator-status ${data.adx >= 25 ? 'trending' : 'neutral'}`}>
                {data.adx >= 25 ? 'Trending' : 'Ranging'}
              </span>
              <span className="indicator-desc">+DI: {fmt(data.pdi)} / -DI: {fmt(data.mdi)}</span>
            </div>
            <div className="indicator-card">
              <span className="indicator-name">SMAs</span>
              <span className="indicator-desc">
                20: {data.sma20 ? '$' + fmt(data.sma20) : '—'} &nbsp; 50: {data.sma50 ? '$' + fmt(data.sma50) : '—'}
              </span>
              <span className="indicator-desc" style={{ marginTop: '0.1rem' }}>
                100W: {data.sma100 ? '$' + fmt(data.sma100) : '—'} &nbsp; 200W: {data.sma200 ? '$' + fmt(data.sma200) : '—'}
              </span>
              {data.sma20 && data.sma50 && <span className="indicator-desc" style={{ color: data.sma20 > data.sma50 ? 'var(--green)' : 'var(--red)' }}>
                {data.sma20 > data.sma50 ? 'Golden cross setup' : 'Death cross setup'}
              </span>}
            </div>
          </div>

          <div className="entry-box">
            <div className="entry-row">
              <div className="entry-item">
                <span className="label">Entry Zone</span>
                <span className="value green">${fmt(data.entryLow)} – ${fmt(data.entryHigh)}</span>
              </div>
              <div className="entry-item">
                <span className="label">Stop Loss</span>
                <span className="value red">${fmt(data.sl)}</span>
              </div>
              <div className="entry-item">
                <span className="label">Target</span>
                <span className="value green">${fmt(data.target)}</span>
              </div>
              <div className="entry-item">
                <span className="label">Risk/Reward</span>
                <span className="value">{data.rr}</span>
              </div>
            </div>
            {data.rr !== '—' && <div className="rr-bar"><div className="rr-fill" style={{ width: `${Math.min(100, +data.rr * 50)}%` }}></div></div>}
          </div>

          {period === '3mo' && <div className="quarter-box">
            <span className="quarter-title">Last Quarter</span>
            <div className="quarter-stats">
              <span>High: <strong>${fmt(data.qHigh)}</strong></span>
              <span>Low: <strong>${fmt(data.qLow)}</strong></span>
              <span>Return: <strong className={+data.qReturn >= 0 ? 'green' : 'red'}>{data.qReturn}%</strong></span>
              <span>Volume: <strong>{data.volLevel === 'high' ? '▲ High' : data.volLevel === 'low' ? '▼ Low' : '● Avg'}</strong></span>
            </div>
          </div>}

          {period === '1y' && <div className="quarter-box">
            <div className="quarter-stats">
              <span>Volume vs Avg: <strong className={data.volLevel === 'high' ? 'green' : data.volLevel === 'low' ? 'red' : ''}>
                {data.volLevel === 'high' ? '▲ ' : data.volLevel === 'low' ? '▼ ' : '● '}{fmtInt(data.volRatio)}x
              </strong></span>
              <span>SMA 200: <strong>${data.sma200 ? fmt(data.sma200) : '—'}</strong></span>
              <span>Price vs SMA200: <strong className={data.price > data.sma200 ? 'green' : 'red'}>{data.price > data.sma200 ? 'Above' : 'Below'}</strong></span>
            </div>
          </div>}
        </div>

        <div className="stock-sidebar">
          <div className="sidebar-card">
            <div className="sidebar-title">Company Overview</div>
            {data.overview ? (
              <div className="overview-grid">
                <div className="overview-item">
                  <span className="ov-label">Mkt Cap</span>
                  <span className="ov-value">{fmtCap(data.overview.marketCap)}</span>
                </div>
                <div className="overview-item">
                  <span className="ov-label">P/E</span>
                  <span className="ov-value">{data.overview.peRatio ? fmt(+data.overview.peRatio) : '—'}</span>
                </div>
                <div className="overview-item">
                  <span className="ov-label">EPS</span>
                  <span className="ov-value">{data.overview.eps ? '$' + fmt(+data.overview.eps) : '—'}</span>
                </div>
                <div className="overview-item">
                  <span className="ov-label">Beta</span>
                  <span className="ov-value">{data.overview.beta ? fmt(+data.overview.beta) : '—'}</span>
                </div>
                <div className="overview-item">
                  <span className="ov-label">Div Yield</span>
                  <span className="ov-value">{data.overview.dividendYield ? (+data.overview.dividendYield * 100).toFixed(2) + '%' : '—'}</span>
                </div>
                <div className="overview-item">
                  <span className="ov-label">52W High</span>
                  <span className="ov-value" style={{color:'var(--green)'}}>${data.overview.week52High ? fmt(+data.overview.week52High) : '—'}</span>
                </div>
                <div className="overview-item">
                  <span className="ov-label">52W Low</span>
                  <span className="ov-value" style={{color:'var(--red)'}}>${data.overview.week52Low ? fmt(+data.overview.week52Low) : '—'}</span>
                </div>
                <div className="overview-item full">
                  <span className="ov-label">Sector</span>
                  <span className="ov-value">{data.overview.sector || '—'}</span>
                </div>
              </div>
            ) : (
              <div className="ov-unavailable">Fundamental data unavailable</div>
            )}
          </div>

          <div className="sidebar-card">
            <div className="sidebar-title">Key Levels</div>
            <div className="levels-section">
              <div className="levels-subtitle">Pivot Points</div>
              <div className="level-row"><span className="level-label">R2</span><span className="level-value" style={{color:'var(--red)'}}>${fmt(data.r2)}</span></div>
              <div className="level-row"><span className="level-label">R1</span><span className="level-value" style={{color:'var(--red)'}}>${fmt(data.r1)}</span></div>
              <div className="level-row"><span className="level-label pivot">Pivot</span><span className="level-value pivot">${fmt(data.pivot)}</span></div>
              <div className="level-row"><span className="level-label">S1</span><span className="level-value" style={{color:'var(--green)'}}>${fmt(data.s1)}</span></div>
              <div className="level-row"><span className="level-label">S2</span><span className="level-value" style={{color:'var(--green)'}}>${fmt(data.pivotS2)}</span></div>
            </div>
            <div className="levels-divider"></div>
            <div className="levels-section">
              <div className="levels-subtitle">Fibonacci</div>
              <div className="level-row"><span className="level-label">0.236</span><span className="level-value">${fmt(data.fib236)}</span></div>
              <div className="level-row"><span className="level-label">0.382</span><span className="level-value">${fmt(data.fib382)}</span></div>
              <div className="level-row"><span className="level-label">0.500</span><span className="level-value">${fmt(data.fib500)}</span></div>
              <div className="level-row"><span className="level-label">0.618</span><span className="level-value">${fmt(data.fib618)}</span></div>
              <div className="level-row"><span className="level-label">0.786</span><span className="level-value">${fmt(data.fib786)}</span></div>
            </div>
          </div>
        </div>
      </div>}
    </div>
  )
}
