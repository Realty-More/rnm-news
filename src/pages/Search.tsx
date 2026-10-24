import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { useDebounced } from '../lib/hooks.ts'
import { PostFeed } from './News.tsx'
import { usePageTitle } from './usePageTitle.ts'

// Shortcuts only: each one runs a normal search on the site.
const SHORTCUTS = ['RERA', 'Gurugram', 'Noida', 'Mumbai', 'Bengaluru', 'Affordable housing', 'Luxury housing', 'Data centre']
const RECENT_KEY = 'rnm-recent-searches'

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function Search() {
  usePageTitle('Search')
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(params.get('q') ?? '')
  const [recent, setRecent] = useState(readRecent)
  const query = useDebounced(text.trim(), 450)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!params.get('q')) input.current?.focus()
  }, [])

  useEffect(() => {
    setParams(query ? { q: query } : {}, { replace: true })
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
          placeholder="Search news, cities, developers"
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

      {query.length >= 2 ? (
        <PostFeed search={query} />
      ) : (
        <div className="search-idle">
          {recent.length > 0 && (
            <>
              <div className="section-head">
                <h2>Recent</h2>
                <button className="link-btn" onClick={clearRecent}>
                  Clear
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
            <h2>Try</h2>
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
