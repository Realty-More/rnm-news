// Realty markets: BSE Realty index, realty stocks, top gainers/losers (TradingView widgets) and the news
// that names each company. We show prices and headlines only; we don't explain moves or give advice.
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { INDICES, NSE_LINKS, REALTY_INDEX, REALTY_STOCKS, TvWidget, useTvTheme } from '../components/TvWidget.tsx'
import { ago, useT } from '../lib/i18n.ts'
import { formatDate } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { PUSH_API } from '../lib/push.ts'
import { usePageTitle } from './usePageTitle.ts'

interface Headline {
  title: string
  source: string
  link: string
  date: string
}
interface MarketNews {
  generatedAt: string
  sources: string[]
  sector: Headline[]
  stocks: { symbol: string; name: string; news: Headline[] }[]
}

/** NSE/BSE regular session: Mon–Fri, 9:15 AM–3:30 PM IST (exchange holidays not included). */
export function marketStatus(now = new Date()): { open: boolean; label: string } {
  const ist = new Date(now.getTime() + 5.5 * 3600000)
  const day = ist.getUTCDay()
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  const open = day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins < 15 * 60 + 30
  if (open) return { open, label: 'Market open' }
  return { open, label: day >= 1 && day <= 5 && mins >= 15 * 60 + 30 ? 'Market closed · today’s closing prices' : 'Market closed · last closing prices' }
}

export function Markets() {
  usePageTitle('Markets')
  const t = useT()
  const theme = useTvTheme()
  const status = marketStatus()
  const news = useAsync(PUSH_API ? 'market:news' : null, async (signal) => {
    const res = await fetch(`${PUSH_API}/market/news`, { signal })
    if (!res.ok) throw new Error('Market news is not available right now.')
    return (await res.json()) as MarketNews
  })

  return (
    <div className="page markets">
      <div className="page-head">
        <h1>{t('markets.title')}</h1>
        <p className="page-sub">
          <span className={`market-status ${status.open ? 'open' : ''}`}>
            <span className="live-dot" aria-hidden="true" /> {status.label}
          </span>
        </p>
      </div>

      <section className="band" aria-labelledby="indices-h">
        <div className="section-head">
          <h2 id="indices-h">{t('markets.indices')}</h2>
        </div>
        <div className="tv-card">
          <TvWidget
            kind="market-quotes"
            height={INDICES.length * 40 + 90}
            config={{
              width: '100%',
              height: INDICES.length * 40 + 90,
              symbolsGroups: [{ name: 'Indices', symbols: INDICES.map((s) => ({ name: s.symbol, displayName: s.name })) }],
              showSymbolLogo: true,
              colorTheme: theme,
              isTransparent: true,
              locale: 'en',
            }}
          />
        </div>
        <div className="nse-box">
          <div className="nse-head">
            <strong>NSE · Nifty</strong>
            <span>{t('markets.nseNote')}</span>
          </div>
          <div className="nse-links">
            {NSE_LINKS.map((l) => (
              <a key={l.label} className="btn ghost small" href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label} <Icon name="external" size={14} />
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="idx-h">
        <div className="section-head">
          <h2 id="idx-h">{REALTY_INDEX.name}</h2>
        </div>
        <div className="tv-card">
          <TvWidget
            kind="symbol-overview"
            height={300}
            config={{
              symbols: [[REALTY_INDEX.name, `${REALTY_INDEX.symbol}|1D`]],
              chartOnly: false,
              width: '100%',
              height: 300,
              locale: 'en',
              colorTheme: theme,
              autosize: false,
              showVolume: false,
              hideDateRanges: false,
              scalePosition: 'right',
              chartType: 'area',
              lineColor: '#F58220',
              topColor: 'rgba(251,165,25,0.35)',
              bottomColor: 'rgba(251,165,25,0.02)',
              isTransparent: true,
              dateRanges: ['1d|1', '1m|30', '3m|60', '12m|1D', '60m|1W'],
            }}
          />
        </div>
      </section>

      <section className="band" aria-labelledby="stocks-h">
        <div className="section-head">
          <h2 id="stocks-h">{t('markets.stocks')}</h2>
        </div>
        <div className="tv-card">
          <TvWidget
            kind="market-quotes"
            height={REALTY_STOCKS.length * 40 + 90}
            config={{
              width: '100%',
              height: REALTY_STOCKS.length * 40 + 90,
              symbolsGroups: [{ name: 'Realty', symbols: REALTY_STOCKS.map((s) => ({ name: s.symbol, displayName: s.name })) }],
              showSymbolLogo: true,
              colorTheme: theme,
              isTransparent: true,
              locale: 'en',
            }}
          />
        </div>
      </section>

      <section className="band" aria-labelledby="movers-h">
        <div className="section-head">
          <h2 id="movers-h">{t('markets.movers')}</h2>
        </div>
        <p className="page-sub movers-note">{status.open ? t('markets.moversOpen') : t('markets.moversClosed')}</p>
        <div className="tv-card">
          <TvWidget
            kind="hotlists"
            height={440}
            config={{ colorTheme: theme, dateRange: '1D', exchange: 'BSE', showChart: false, locale: 'en', isTransparent: true, showSymbolLogo: true, showFloatingTooltip: false, width: '100%', height: 440 }}
          />
        </div>
      </section>

      <section className="band" aria-labelledby="why-h">
        <div className="section-head">
          <h2 id="why-h">{t('markets.why')}</h2>
        </div>
        <p className="page-sub movers-note">{t('markets.whyNote')}</p>
        {news.error && !news.data ? (
          <ErrorState error={news.error} onRetry={news.reload} />
        ) : !news.data ? (
          <SkeletonList count={3} />
        ) : (
          <WhyList data={news.data} />
        )}
      </section>

      <p className="market-disclaimer">
        Prices: TradingView (BSE data, may be delayed; “E” marks delayed or end-of-day prices). Headlines: {news.data?.sources.join(', ') ?? 'business news sites'} and RealtyNMore. For information only, not investment advice.
      </p>
    </div>
  )
}

function WhyList({ data }: { data: MarketNews }) {
  const t = useT()
  const withNews = data.stocks.filter((s) => s.news.length)
  const without = data.stocks.filter((s) => !s.news.length)
  return (
    <>
      {data.sector.length > 0 && (
        <div className="why-card sector">
          <h3>{t('markets.sector')}</h3>
          <NewsLines items={data.sector} />
        </div>
      )}
      {withNews.map((s) => (
        <div key={s.symbol} className="why-card">
          <h3>{s.name}</h3>
          <NewsLines items={s.news} />
        </div>
      ))}
      {without.length > 0 && (
        <p className="no-news">
          {t('markets.noNews')}: {without.map((s) => s.name).join(', ')}
        </p>
      )}
    </>
  )
}

function NewsLines({ items }: { items: Headline[] }) {
  return (
    <ul className="why-news">
      {items.map((h) => (
        <li key={h.link}>
          {h.link.startsWith('#') ? <Link to={h.link.slice(1)}>{h.title}</Link> : (
            <a href={h.link} target="_blank" rel="noopener noreferrer">
              {h.title} <Icon name="external" size={12} />
            </a>
          )}
          <span className="meta">
            {h.source} · {ago(h.date) ?? formatDate(h.date)}
          </span>
        </li>
      ))}
    </ul>
  )
}
