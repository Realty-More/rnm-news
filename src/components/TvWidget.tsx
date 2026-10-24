// TradingView's free embeddable widgets (licensed display of market data; free with the TradingView credit).
import { useEffect, useRef } from 'react'
import { effectiveTheme, useTheme } from '../lib/prefs.ts'
import { useAsync, useOnline } from '../lib/hooks.ts'
import { PUSH_API } from '../lib/push.ts'

/**
 * Nifty Realty's 10 companies (NSE's list; the app updates it from NSE via the server).
 * NSE prices aren't licensed for free widgets, so prices come from the same companies' BSE listings.
 */
export const NIFTY_REALTY_FALLBACK = [
  { symbol: 'BSE:ABREL', name: 'Aditya Birla Real Estate' },
  { symbol: 'BSE:ANANTRAJ', name: 'Anant Raj' },
  { symbol: 'BSE:BRIGADE', name: 'Brigade Enterprises' },
  { symbol: 'BSE:DLF', name: 'DLF' },
  { symbol: 'BSE:GODREJPROP', name: 'Godrej Properties' },
  { symbol: 'BSE:LODHA', name: 'Lodha Developers' },
  { symbol: 'BSE:OBEROIRLTY', name: 'Oberoi Realty' },
  { symbol: 'BSE:PHOENIXLTD', name: 'Phoenix Mills' },
  { symbol: 'BSE:PRESTIGE', name: 'Prestige Estates Projects' },
  { symbol: 'BSE:SOBHA', name: 'Sobha' },
]
/** Other listed developers RealtyNMore covers often. */
export const MORE_REALTY = [
  { symbol: 'BSE:SIGNATURE', name: 'Signature Global' },
  { symbol: 'BSE:MAHLIFE', name: 'Mahindra Lifespace' },
  { symbol: 'BSE:SUNTECK', name: 'Sunteck' },
  { symbol: 'BSE:KOLTEPATIL', name: 'Kolte-Patil' },
]

/** Current Nifty Realty members from NSE's published list (falls back to the list above). */
export function useNiftyRealty(): { symbol: string; name: string }[] {
  const res = useAsync(PUSH_API ? 'market:nifty-realty' : null, async (signal) => {
    const r = await fetch(`${PUSH_API}/market/nifty-realty`, { signal })
    if (!r.ok) throw new Error('list unavailable')
    const data = (await r.json()) as { stocks: { symbol: string; name: string }[] }
    return data.stocks.map((st) => ({ symbol: `BSE:${st.symbol}`, name: st.name }))
  })
  return res.data?.length ? res.data : NIFTY_REALTY_FALLBACK
}
export const REALTY_INDEX = { symbol: 'BSE:REALTY', name: 'BSE Realty' }
export const SENSEX = { symbol: 'BSE:SENSEX', name: 'Sensex' }
export const INDICES = [SENSEX, REALTY_INDEX, { symbol: 'BSE:BSE500', name: 'BSE 500' }]

/** NSE isn't licensed for free embedding, so NSE figures are links to NSE's own website. */
export const NSE_LINKS = [
  { label: 'Nifty 50', url: 'https://www.nseindia.com/market-data/live-equity-market?symbol=NIFTY%2050' },
  { label: 'Nifty Realty', url: 'https://www.nseindia.com/market-data/live-equity-market?symbol=NIFTY%20REALTY' },
  { label: 'NSE top gainers & losers', url: 'https://www.nseindia.com/market-data/top-gainers-losers' },
]

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
