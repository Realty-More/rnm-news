// TradingView's free embeddable widgets (licensed display of market data; free with the TradingView credit).
import { useEffect, useRef } from 'react'
import { effectiveTheme, useTheme } from '../lib/prefs.ts'
import { useOnline } from '../lib/hooks.ts'

/** NSE data isn't licensed for free widgets, so the app uses BSE symbols. */
export const REALTY_STOCKS = [
  { symbol: 'BSE:DLF', name: 'DLF' },
  { symbol: 'BSE:GODREJPROP', name: 'Godrej Properties' },
  { symbol: 'BSE:LODHA', name: 'Lodha' },
  { symbol: 'BSE:OBEROIRLTY', name: 'Oberoi Realty' },
  { symbol: 'BSE:PRESTIGE', name: 'Prestige' },
  { symbol: 'BSE:PHOENIXLTD', name: 'Phoenix Mills' },
  { symbol: 'BSE:BRIGADE', name: 'Brigade' },
  { symbol: 'BSE:SOBHA', name: 'Sobha' },
  { symbol: 'BSE:ANANTRAJ', name: 'Anant Raj' },
  { symbol: 'BSE:SIGNATURE', name: 'Signature Global' },
  { symbol: 'BSE:MAHLIFE', name: 'Mahindra Lifespace' },
  { symbol: 'BSE:SUNTECK', name: 'Sunteck' },
  { symbol: 'BSE:KOLTEPATIL', name: 'Kolte-Patil' },
]
export const REALTY_INDEX = { symbol: 'BSE:REALTY', name: 'BSE Realty' }

export function useTvTheme(): 'light' | 'dark' {
  const [pref] = useTheme()
  return effectiveTheme(pref)
}

export function TvWidget({ kind, config, height }: { kind: string; config: Record<string, unknown>; height: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const online = useOnline()
  const json = JSON.stringify(config)

  useEffect(() => {
    const el = ref.current
    if (!el || !online) return
    el.innerHTML = '<div class="tradingview-widget-container__widget"></div>'
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.async = true
    script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${kind}.js`
    script.innerHTML = json
    el.appendChild(script)
    return () => {
      el.innerHTML = ''
    }
  }, [kind, json, online])

  if (!online) return <div className="tv-offline">Market data needs an internet connection.</div>
  return <div className="tradingview-widget-container tv" ref={ref} style={{ minHeight: height }} />
}
