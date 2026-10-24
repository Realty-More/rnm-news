// Owner-only Content Studio: what readers want, what to write next, keywords and SEO fixes.
// Hidden from readers (no menu link); opened from Settings on the owner's device or #/studio.
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDate } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { forgetOwner, ownerKey, studio, unlock } from '../lib/owner.ts'
import { usePageTitle } from './usePageTitle.ts'
import { WHATSAPP_CHANNEL, whatsappShareUrl } from '../lib/config.ts'
import { smartLink } from '../lib/stats.ts'
import { loadFeed } from '../lib/videos.ts'
import { fetchPosts } from '../lib/wp.ts'

interface Overview {
  subscribers: number
  views7: number
  opens7: number
  topArticles: { id: number; opens: number; title: string; link?: string }[]
  searches: { q: string; n: number }[]
  zeroSearches: { q: string; n: number }[]
}
interface Ideas {
  notCovered: { source: string; title: string; link: string; date: string }[]
  trends: { title: string; traffic: string; news: string[]; realEstate: boolean }[]
  sections: { section: string; lastPost: string | null; daysAgo: number | null }[]
  readerGaps: { q: string; n: number }[]
}
interface Keywords {
  results: { seed: string; suggestions: string[] }[]
}
interface RivalItem {
  title: string
  date: string
  link: string
}
interface Rivals {
  generatedAt: string
  sources: {
    name: string
    basis: string
    sampled: number
    perDay: number
    posts30: number | null
    topics: Record<string, number>
    cities: Record<string, number>
    peakHours: number[]
    style: { avgWords: number; withNumbers: number; questions: number }
    latest: RivalItem[]
  }[]
  topics: { key: string; label: string }[]
  hotWords: { word: string; n: number; ours: number }[]
  advice: { kind: 'gap' | 'strength' | 'volume' | 'city' | 'timing' | 'style'; text: string; examples?: RivalItem[] }[]
}
interface Seo {
  average: number
  posts: { id: number; title: string; link: string; issues: string[]; score: number }[]
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'ideas', label: 'What to write' },
  { key: 'rivals', label: 'Competitors' },
  { key: 'whatsapp', label: 'WhatsApp post' },
  { key: 'keywords', label: 'Keywords' },
  { key: 'seo', label: 'SEO check' },
] as const
type Tab = (typeof TABS)[number]['key']

export function Studio() {
  usePageTitle('Content Studio')
  const [key, setKey] = useState(ownerKey)
  if (!key) return <Unlock onDone={() => setKey(ownerKey())} />
  return (
    <StudioHome
      onLock={() => {
        forgetOwner()
        setKey(null)
      }}
    />
  )
}

function Unlock({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const ok = await unlock(value)
    setBusy(false)
    if (ok) onDone()
    else toast('That key is not right')
  }
  return (
    <div className="page studio-lock">
      <div className="lock-card">
        <Icon name="settings" size={28} />
        <h1>Content Studio</h1>
        <p>For the RealtyNMore owner only. Enter the owner key once on this device.</p>
        <form onSubmit={submit}>
          <input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Owner key" aria-label="Owner key" />
          <button className="btn" disabled={busy || value.trim().length < 8}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  )
}

function StudioHome({ onLock }: { onLock: () => void }) {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview') as Tab
  return (
    <div className="page studio">
      <div className="page-head studio-head">
        <div>
          <span className="owner-badge">Owner only</span>
          <h1>Content Studio</h1>
          <p className="page-sub">Real data from the app, realtynmore.com, Google and other news sites</p>
        </div>
        <button className="btn ghost small" onClick={onLock}>
          Lock
        </button>
      </div>
      <div className="chips" role="tablist" aria-label="Studio">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`chip ${tab === t.key ? 'active' : ''}`} onClick={() => setParams({ tab: t.key }, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'ideas' && <IdeasTab />}
      {tab === 'rivals' && <RivalsTab />}
      {tab === 'whatsapp' && <WhatsAppTab />}
      {tab === 'keywords' && <KeywordsTab />}
      {tab === 'seo' && <SeoTab />}
    </div>
  )
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {note && <p className="panel-note">{note}</p>}
      {children}
    </section>
  )
}

function OverviewTab() {
  const res = useAsync('studio:overview', (s) => studio<Overview>('overview', undefined, s))
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data) return <SkeletonList count={3} />
  const d = res.data
  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <b>{d.subscribers}</b>
          <span>Alert subscribers</span>
        </div>
        <div className="kpi">
          <b>{d.views7.toLocaleString('en-IN')}</b>
          <span>Screen views · 7 days</span>
        </div>
        <div className="kpi">
          <b>{d.opens7.toLocaleString('en-IN')}</b>
          <span>Stories read · 7 days</span>
        </div>
      </div>
      <Panel title="Most read in the app · 7 days" note="Write more on topics like these.">
        {d.topArticles.length ? (
          <ol className="rank">
            {d.topArticles.map((a) => (
              <li key={a.id}>
                <a href={a.link} target="_blank" rel="noopener noreferrer">
                  {a.title}
                </a>
                <span>{a.opens}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty">No reads recorded yet.</p>
        )}
      </Panel>
      <Panel title="What readers search for · 30 days">
        {d.searches.length ? <TagList items={d.searches} /> : <p className="empty">No searches yet.</p>}
      </Panel>
      <Panel title="Searches with no results · 30 days" note="Readers looked for these and found nothing: strong story ideas.">
        {d.zeroSearches.length ? <TagList items={d.zeroSearches} warn /> : <p className="empty">None so far.</p>}
      </Panel>
    </>
  )
}

function TagList({ items, warn = false }: { items: { q: string; n: number }[]; warn?: boolean }) {
  return (
    <div className="tag-list">
      {items.map((s) => (
        <span key={s.q} className={`tag ${warn ? 'warn' : ''}`}>
          {s.q} <b>{s.n}</b>
        </span>
      ))}
    </div>
  )
}

function IdeasTab() {
  const res = useAsync('studio:ideas', (s) => studio<Ideas>('ideas', undefined, s))
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data) return <SkeletonList count={4} />
  const d = res.data
  const reTrends = d.trends.filter((t) => t.realEstate)
  return (
    <>
      <Panel title="Covered by others, not by RealtyNMore" note="Recent stories on ET Realty and Hindustan Times Real Estate with no matching RealtyNMore headline.">
        {d.notCovered.length ? (
          <ul className="idea-list">
            {d.notCovered.map((r) => (
              <li key={r.link}>
                <a href={r.link} target="_blank" rel="noopener noreferrer">
                  {r.title}
                </a>
                <span className="meta">
                  {r.source}
                  {r.date && !Number.isNaN(Date.parse(r.date)) && ` · ${formatDate(new Date(r.date).toISOString())}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">You have covered everything they published recently.</p>
        )}
      </Panel>
      <Panel title="Sections that need a new post" note="Days since the last story in each section.">
        <ul className="fresh-list">
          {d.sections.map((s) => (
            <li key={s.section} className={s.daysAgo !== null && s.daysAgo > 14 ? 'stale' : ''}>
              <span>{s.section}</span>
              <b>{s.daysAgo === null ? 'never' : s.daysAgo === 0 ? 'today' : `${s.daysAgo} days`}</b>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Google Trends India today" note={reTrends.length ? 'Real-estate related searches trending now.' : 'Nothing real-estate related is trending today. All trends shown for reference.'}>
        <ul className="idea-list">
          {(reTrends.length ? reTrends : d.trends).map((t) => (
            <li key={t.title}>
              <span className="trend-title">
                {t.title} <em>{t.traffic} searches</em>
              </span>
              {t.news[0] && <span className="meta">{t.news[0]}</span>}
            </li>
          ))}
        </ul>
      </Panel>
      {d.readerGaps.length > 0 && (
        <Panel title="App searches with no results">
          <TagList items={d.readerGaps} warn />
        </Panel>
      )}
    </>
  )
}

const hour = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
const ADVICE_ICON: Record<Rivals['advice'][number]['kind'], string> = { gap: '➕', strength: '⭐', volume: '📈', city: '📍', timing: '⏰', style: '✍️' }

function RivalsTab() {
  const res = useAsync('studio:rivals', (s) => studio<Rivals>('competitors', undefined, s))
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data) return <SkeletonList count={5} />
  const d = res.data
  const [us, ...them] = d.sources
  const avg = (key: string) => Math.round(them.reduce((a, s) => a + (s.topics[key] ?? 0), 0) / Math.max(1, them.length))
  const cityRows = Object.keys(us.cities)
    .map((c) => ({ c, you: us.cities[c], them: them.reduce((a, s) => a + (s.cities[c] ?? 0), 0) }))
    .filter((r) => r.you + r.them > 0)
    .sort((a, b) => b.them + b.you - (a.them + a.you))
    .slice(0, 10)

  return (
    <>
      <Panel title="What RealtyNMore should do next" note="Based on the last 7 days of headlines from RealtyNMore and competitors.">
        <ul className="advice-list">
          {d.advice.map((a, i) => (
            <li key={i} className={`advice ${a.kind}`}>
              <span className="advice-icon" aria-hidden="true">
                {ADVICE_ICON[a.kind]}
              </span>
              <div>
                <p>{a.text}</p>
                {a.examples?.length ? (
                  <ul className="examples">
                    {a.examples.map((e) => (
                      <li key={e.link}>
                        <a href={e.link} target="_blank" rel="noopener noreferrer">
                          {e.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Scoreboard · last 7 days">
        <div className="table-wrap">
          <table className="score-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Stories/day</th>
                <th>Headlines with numbers</th>
                <th>Busiest hours (IST)</th>
              </tr>
            </thead>
            <tbody>
              {d.sources.map((s, i) => (
                <tr key={s.name} className={i === 0 ? 'us' : ''}>
                  <td>{s.name}</td>
                  <td>{s.perDay}</td>
                  <td>{s.style.withNumbers}%</td>
                  <td>{s.peakHours.map(hour).join(', ') || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Topic mix: you vs competitors" note="Share of headlines in each topic. Orange = RealtyNMore, grey = competitor average.">
        <div className="bars">
          {d.topics.map((t) => {
            const you = us.topics[t.key] ?? 0
            const others = avg(t.key)
            return (
              <div key={t.key} className="bar-row">
                <span className="bar-label">{t.label}</span>
                <div className="bar-pair">
                  <span className="bar you" style={{ width: `${Math.max(you, 1)}%` }} />
                  <b>{you}%</b>
                </div>
                <div className="bar-pair">
                  <span className="bar them" style={{ width: `${Math.max(others, 1)}%` }} />
                  <b>{others}%</b>
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="Cities in headlines · 7 days">
        <ul className="fresh-list">
          {cityRows.map((r) => (
            <li key={r.c} className={r.them >= 3 && r.you <= Math.floor(r.them / 4) ? 'stale' : ''}>
              <span>{r.c}</span>
              <b>
                you {r.you} · them {r.them}
              </b>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Hot words in competitor headlines" note="How often the word appears in their headlines this week, and in yours.">
        <div className="tag-list">
          {d.hotWords.map((w) => (
            <span key={w.word} className={`tag ${w.ours === 0 ? 'warn' : ''}`}>
              {w.word} <b>{w.n}</b> <small>you {w.ours}</small>
            </span>
          ))}
        </div>
      </Panel>

      {them.map((s) => (
        <Panel key={s.name} title={`Latest from ${s.name}`}>
          <ul className="idea-list">
            {s.latest.map((i) => (
              <li key={i.link}>
                <a href={i.link} target="_blank" rel="noopener noreferrer">
                  {i.title}
                </a>
                <span className="meta">{formatDate(i.date)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ))}

      <p className="panel-note">
        Sources: {d.sources.map((s) => `${s.name} (${s.basis})`).join('; ')}. Only public feeds, sitemaps and open APIs are used. Sites that block automated reading (e.g. Realty Plus, 99acres, Housing.com) are not included.
      </p>
    </>
  )
}

/** Builds a ready-to-paste WhatsApp post (channel, community or broadcast list) from real stories and videos. */
function WhatsAppTab() {
  const stories = useAsync('studio:wa:stories', (s) => fetchPosts({ perPage: 15 }, s))
  const videos = useAsync('yt:latest', () => loadFeed('latest'))
  const [picked, setPicked] = useState<number[] | null>(null)
  const [pickedVideos, setPickedVideos] = useState<string[]>([])
  const [edited, setEdited] = useState<string | null>(null)

  const posts = stories.data?.posts ?? []
  const chosen = picked ?? posts.slice(0, 5).map((p) => p.id)
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const today = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())
  const lines: string[] = [`🏠 *R&M News | ${today}*`, '']
  posts
    .filter((p) => chosen.includes(p.id))
    .forEach((p, i) => lines.push(`${i + 1}. *${p.title}*`, `👉 ${smartLink(p)}`, ''))
  ;(videos.data?.videos ?? [])
    .filter((v) => pickedVideos.includes(v.id))
    .forEach((v) => lines.push(`▶️ *${v.title}*`, v.url, ''))
  lines.push('📲 Read more in the R&M News app: https://realty-more.github.io/rnm-news/')
  if (WHATSAPP_CHANNEL) lines.push(`🔔 Follow our WhatsApp Channel: ${WHATSAPP_CHANNEL}`)
  const generated = lines.join('\n')
  const message = edited ?? generated

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      toast('Post copied. Paste it in your WhatsApp Channel.')
    } catch {
      toast('Could not copy')
    }
  }

  return (
    <>
      <Panel title="How to reach 1,000+ people for free" note="Post once in a WhatsApp Channel and every follower gets it. No per-message cost and no ban risk.">
        <ol className="steps">
          <li>WhatsApp → <b>Updates</b> → <b>+</b> → <b>Create channel</b> (one time; use the company number).</li>
          <li>Pick stories and videos below, then tap <b>Copy post</b>.</li>
          <li>Open your channel and paste. For a video, attach the video file from your gallery and paste this text as its caption.</li>
          <li>Share the channel link in the app, on Instagram and in your email signature so people follow it.</li>
        </ol>
      </Panel>

      <Panel title="Pick stories" note="The latest 5 are selected; tap to change.">
        {stories.error && !stories.data ? (
          <ErrorState error={stories.error} onRetry={stories.reload} />
        ) : (
          <ul className="pick-list">
            {posts.map((p) => (
              <li key={p.id}>
                <label>
                  <input type="checkbox" checked={chosen.includes(p.id)} onChange={() => (setPicked(toggle(chosen, p.id)), setEdited(null))} />
                  <span>{p.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Add videos (optional)">
        <ul className="pick-list">
          {(videos.data?.videos ?? []).slice(0, 8).map((v) => (
            <li key={v.id}>
              <label>
                <input type="checkbox" checked={pickedVideos.includes(v.id)} onChange={() => (setPickedVideos(toggle(pickedVideos, v.id)), setEdited(null))} />
                <span>▶️ {v.title}</span>
              </label>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Your post" note="Story links show a photo-and-title preview in WhatsApp and open in the app. You can edit the text before copying.">
        <textarea className="wa-compose" value={message} onChange={(e) => setEdited(e.target.value)} rows={14} aria-label="WhatsApp post text" />
        <div className="action-row">
          <button className="btn" onClick={copy}>
            <Icon name="share" size={16} /> Copy post
          </button>
          <a className="btn ghost wa-share" href={whatsappShareUrl(message)} target="_blank" rel="noopener noreferrer">
            <Icon name="whatsapp" size={16} /> Open in WhatsApp
          </a>
          {edited !== null && (
            <button className="btn ghost" onClick={() => setEdited(null)}>
              Reset
            </button>
          )}
        </div>
        <p className="panel-note">{message.length.toLocaleString('en-IN')} characters</p>
      </Panel>
    </>
  )
}

function KeywordsTab() {
  const [input, setInput] = useState('')
  const [seeds, setSeeds] = useState('')
  const res = useAsync(`studio:keywords:${seeds}`, (s) => studio<Keywords>(`keywords${seeds ? `?seeds=${encodeURIComponent(seeds)}` : ''}`, undefined, s))
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied')
    } catch {
      toast('Could not copy')
    }
  }
  return (
    <>
      <form
        className="kw-form"
        onSubmit={(e) => {
          e.preventDefault()
          setSeeds(input.trim())
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Your topics, comma-separated (e.g. flats in pune, jewar airport)" aria-label="Keyword topics" />
        <button className="btn small">Find</button>
      </form>
      <p className="panel-note">What people actually type into Google in India. Google doesn't share search volumes for free, so these are ordered by Google's own suggestion rank. Tap a phrase to copy it.</p>
      {res.error && !res.data ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <SkeletonList count={4} />
      ) : (
        res.data.results.map((r) => (
          <Panel key={r.seed} title={r.seed}>
            {r.suggestions.length ? (
              <div className="tag-list">
                {r.suggestions.map((s) => (
                  <button key={s} className="tag" onClick={() => copy(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty">No suggestions.</p>
            )}
          </Panel>
        ))
      )}
    </>
  )
}

function SeoTab() {
  const res = useAsync('studio:seo', (s) => studio<Seo>('seo', undefined, s))
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data) return <SkeletonList count={4} />
  const d = res.data
  return (
    <>
      <div className="kpis">
        <div className={`kpi ${d.average < 70 ? 'warn' : ''}`}>
          <b>{d.average}/100</b>
          <span>Average SEO score · latest 15 stories</span>
        </div>
      </div>
      <p className="panel-note">Checked on the live website: URL, title length, meta description, image alt text, length, subheadings, internal links, tags and section.</p>
      {d.posts.map((p) => (
        <section key={p.id} className="panel seo-post">
          <div className="seo-head">
            <span className={`score ${p.score < 60 ? 'bad' : p.score < 80 ? 'mid' : 'good'}`}>{p.score}</span>
            <a href={p.link} target="_blank" rel="noopener noreferrer">
              {p.title}
            </a>
          </div>
          {p.issues.length ? (
            <ul className="issues">
              {p.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : (
            <p className="empty">No issues found.</p>
          )}
        </section>
      ))}
    </>
  )
}
