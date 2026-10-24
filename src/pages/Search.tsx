import { useEffect, useRef, useState } from 'react'
import { useT, type TKey } from '../lib/i18n.ts'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { useDebounced } from '../lib/hooks.ts'
import { PostFeed } from './News.tsx'
import { CURATED_CATEGORIES } from '../lib/wp.ts'
import { usePageTitle } from './usePageTitle.ts'

// Shortcuts only: each one runs a normal search on the site.
const SHORTCUTS = ['RERA', 'Gurugram', 'Noida', 'Mumbai', 'Bengaluru', 'Affordable housing', 'Luxury housing', 'Data centre']
const RECENT_KEY = 'rnm-recent-searches'
const PERIODS: { key: string; label: TKey; days: number }[] = [
  { key: '', label: 'period.any', days: 0 },
  { key: '1d', label: 'period.1d', days: 1 },
  { key: '7d', label: 'period.7d', days: 7 },
  { key: '30d', label: 'period.30d', days: 30 },
  { key: '365d', label: 'period.365d', days: 365 },
]

/** Start of the period as an ISO date for the API (rounded to the hour so results cache well). */
function periodStart(key: string): string | undefined {
  const p = PERIODS.find((x) => x.key === key)
  if (!p?.days) return undefined
  const d = new Date(Date.now() - p.days * 86400000)
  d.setMinutes(0, 0, 0)
  return d.toISOString().slice(0, 19)
}

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function Search() {
  usePageTitle('Search')
  const t = useT()
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(params.get('q') ?? '')
  const [recent, setRecent] = useState(readRecent)
  const query = useDebounced(text.trim(), 450)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!params.get('q')) input.current?.focus()
  }, [])

  const section = params.get('c') ?? ''
  const period = params.get('t') ?? ''
  const setFilter = (name: 'c' | 't', value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    setParams(next, { replace: true })
  }

  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (query) next.set('q', query)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
    if (query.length < 3) return
    const next = [query, ...readRecent().filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, 6)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }, [query, setParams])

  const clearRecent = () => {
    setRecent([])
    try {
      localStorage.removeItem(RECENT_KEY)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="page">
      <form className="search-box" role="search" onSubmit={(e) => (e.preventDefault(), input.current?.blur())}>
        <Icon name="search" size={20} />
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          placeholder={t('search.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Search RealtyNMore news"
        />
        {text && (
          <button type="button" className="icon-btn" onClick={() => (setText(''), input.current?.focus())} aria-label="Clear search">
            <Icon name="close" size={18} />
          </button>
        )}
      </form>

      {query.length >= 2 && (
        <div className="search-filters">
          <select className="filter-select" value={section} onChange={(e) => setFilter('c', e.target.value)} aria-label="Section">
            <option value="">{t('search.allSections')}</option>
            {CURATED_CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
          <div className="chips" role="radiogroup" aria-label="Published">
            {PERIODS.map((p) => (
              <button key={p.key} role="radio" aria-checked={period === p.key} className={`chip ${period === p.key ? 'active' : ''}`} onClick={() => setFilter('t', p.key)}>
                {t(p.label)}
              </button>
            ))}
          </div>
        </div>
      )}

      {query.length >= 2 ? (
        <PostFeed search={query} category={CURATED_CATEGORIES.find((c) => c.slug === section)?.id} after={periodStart(period)} />
      ) : (
        <div className="search-idle">
          {recent.length > 0 && (
            <>
              <div className="section-head">
                <h2>{t('search.recent')}</h2>
                <button className="link-btn" onClick={clearRecent}>
                  {t('search.clear')}
                </button>
              </div>
              <div className="chips wrap">
                {recent.map((r) => (
                  <button key={r} className="chip" onClick={() => setText(r)}>
                    <Icon name="clock" size={14} /> {r}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="section-head">
            <h2>{t('search.try')}</h2>
          </div>
          <div className="chips wrap">
            {SHORTCUTS.map((s) => (
              <button key={s} className="chip" onClick={() => setText(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
