// TradingView's free embeddable widgets (licensed display of market data; free with the TradingView credit).
import { useEffect, useRef } from 'react'
import { effectiveTheme, useTheme } from '../lib/prefs.ts'
import { useAsync, useOnline } from '../lib/hooks.ts'
import { PUSH_API } from '../lib/push.ts'

/**
 * Nifty Realty's 10 companies (NSE's list; the app updates it from NSE via the server).
 * NSE prices aren't licensed for free widgets, so prices come from the same companies' BSE listings.
 * Names are kept short: TradingView's table freezes the name column, and long names
 * run under the price when the table is slid sideways on a phone.
 */
export const NIFTY_REALTY_FALLBACK = [
  { symbol: 'BSE:ABREL', name: 'Aditya Birla RE' },
  { symbol: 'BSE:ANANTRAJ', name: 'Anant Raj' },
  { symbol: 'BSE:BRIGADE', name: 'Brigade' },
  { symbol: 'BSE:DLF', name: 'DLF' },
  { symbol: 'BSE:GODREJPROP', name: 'Godrej Prop.' },
  { symbol: 'BSE:LODHA', name: 'Lodha' },
  { symbol: 'BSE:OBEROIRLTY', name: 'Oberoi Realty' },
  { symbol: 'BSE:PHOENIXLTD', name: 'Phoenix Mills' },
  { symbol: 'BSE:PRESTIGE', name: 'Prestige' },
  { symbol: 'BSE:SOBHA', name: 'Sobha' },
]
const SHORT: Record<string, string> = Object.fromEntries(NIFTY_REALTY_FALLBACK.map((s) => [s.symbol, s.name]))

/** Short display name: our own for known symbols, otherwise the first words that fit in 15 characters. */
export function shortName(symbol: string, name: string, max = 15): string {
  if (SHORT[symbol]) return SHORT[symbol]
  const clean = name.replace(/\b(Limited|Ltd\.?|Private|Pvt\.?)(?=\s|$)/gi, '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  let out = ''
  for (const w of clean.split(' ')) {
    if ((out ? `${out} ${w}` : w).length > max) break
    out = out ? `${out} ${w}` : w
  }
  return out || clean.slice(0, max)
}

type Stock = { symbol: string; name: string }
const bse = (list: [string, string][]): Stock[] => list.map(([code, name]) => ({ symbol: `BSE:${code}`, name }))

/** Other listed developers RealtyNMore covers often (also in the Home ticker). */
export const MORE_REALTY = bse([
  ['SIGNATURE', 'Signatureglobal'],
  ['MAHLIFE', 'Mahindra Life'],
  ['SUNTECK', 'Sunteck'],
  ['KOLTEPATIL', 'Kolte-Patil'],
])

/**
 * Everything listed that moves with real estate, by group. Every symbol was checked
 * against TradingView's BSE list (26 Oct 2026).
 */
export const REALTY_GROUPS: { key: string; label: string; note: string; stocks: Stock[] }[] = [
  {
    key: 'developers',
    label: 'More developers',
    note: 'Listed housing and commercial developers outside the Nifty Realty index.',
    stocks: [
      ...MORE_REALTY,
      ...bse([
        ['PURVA', 'Puravankara'],
        ['ASHIANA', 'Ashiana Housing'],
        ['ARVSMART', 'Arvind Smart'],
        ['RUSTOMJEE', 'Rustomjee'],
        ['AJMERA', 'Ajmera Realty'],
        ['EMBDL', 'Embassy Dev.'],
        ['OMAXE', 'Omaxe'],
        ['SURAJEST', 'Suraj Estate'],
        ['ARKADE', 'Arkade'],
        ['HUBTOWN', 'Hubtown'],
        ['MARATHON', 'Marathon Realty'],
        ['TARC', 'TARC'],
        ['MAXESTATES', 'Max Estates'],
        ['SHRIRAMPPS', 'Shriram Prop.'],
        ['RAYMONDREL', 'Raymond Realty'],
        ['DBREALTY', 'Valor Estate'],
        ['NIRLON', 'Nirlon'],
        ['PARSVNATH', 'Parsvnath'],
        ['ELDEHSG', 'Eldeco Housing'],
        ['AGIIL', 'AGI Infra'],
      ]),
    ],
  },
  {
    key: 'reits',
    label: 'REITs',
    note: 'Real estate investment trusts: offices, malls and business parks that pay out rent.',
    stocks: bse([
      ['EMBASSY', 'Embassy REIT'],
      ['MINDSPACE', 'Mindspace REIT'],
      ['BIRET', 'Brookfield REIT'],
      ['NXST', 'Nexus Select'],
      ['KRT', 'Knowledge REIT'],
    ]),
  },
  {
    key: 'hfc',
    label: 'Housing finance',
    note: 'Home-loan lenders: they move with interest rates and housing demand.',
    stocks: bse([
      ['LICHSGFIN', 'LIC Housing'],
      ['BAJAJHFL', 'Bajaj Housing'],
      ['PNBHOUSING', 'PNB Housing'],
      ['HUDCO', 'HUDCO'],
      ['AAVAS', 'Aavas'],
      ['APTUS', 'Aptus'],
      ['HOMEFIRST', 'Home First'],
      ['CANFINHOME', 'Can Fin Homes'],
      ['INDIASHLTR', 'India Shelter'],
      ['REPCOHOME', 'Repco Home'],
    ]),
  },
  {
    key: 'cement',
    label: 'Cement',
    note: 'The biggest input cost of construction.',
    stocks: bse([
      ['ULTRACEMCO', 'UltraTech'],
      ['AMBUJACEM', 'Ambuja'],
      ['ACC', 'ACC'],
      ['SHREECEM', 'Shree Cement'],
      ['DALBHARAT', 'Dalmia Bharat'],
      ['JKCEMENT', 'JK Cement'],
      ['RAMCOCEM', 'Ramco Cements'],
      ['NUVOCO', 'Nuvoco'],
      ['JKLAKSHMI', 'JK Lakshmi'],
      ['BIRLACORPN', 'Birla Corp'],
    ]),
  },
  {
    key: 'materials',
    label: 'Building materials',
    note: 'Paints, tiles, pipes, plywood, wires and steel tubes that go into every home.',
    stocks: bse([
      ['ASIANPAINT', 'Asian Paints'],
      ['BERGEPAINT', 'Berger Paints'],
      ['PIDILITIND', 'Pidilite'],
      ['KAJARIACER', 'Kajaria'],
      ['SOMANYCERA', 'Somany'],
      ['CERA', 'Cera'],
      ['ASTRAL', 'Astral'],
      ['SUPREMEIND', 'Supreme Ind.'],
      ['FINPIPE', 'Finolex Ind.'],
      ['PRINCEPIPE', 'Prince Pipes'],
      ['CENTURYPLY', 'Century Ply'],
      ['GREENPLY', 'Greenply'],
      ['HAVELLS', 'Havells'],
      ['POLYCAB', 'Polycab'],
      ['APLAPOLLO', 'APL Apollo'],
    ]),
  },
  {
    key: 'construction',
    label: 'Construction',
    note: 'Contractors that build homes, offices and infrastructure.',
    stocks: bse([
      ['LT', 'L&T'],
      ['NCC', 'NCC'],
      ['NBCC', 'NBCC'],
      ['AFCONS', 'Afcons'],
      ['PSPPROJECT', 'PSP Projects'],
      ['AHLUCONT', 'Ahluwalia'],
      ['CAPACITE', 'Capacite'],
      ['HGINFRA', 'HG Infra'],
    ]),
  },
]

/** Current Nifty Realty members from NSE's published list (falls back to the list above). */
export function useNiftyRealty(): Stock[] {
  const res = useAsync(PUSH_API ? 'market:nifty-realty' : null, async (signal) => {
    const r = await fetch(`${PUSH_API}/market/nifty-realty`, { signal })
    if (!r.ok) throw new Error('list unavailable')
    const data = (await r.json()) as { stocks: { symbol: string; name: string }[] }
    return data.stocks.map((st) => ({ symbol: `BSE:${st.symbol}`, name: shortName(`BSE:${st.symbol}`, st.name) }))
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
