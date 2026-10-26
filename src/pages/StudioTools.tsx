// Owner & team tools in the Content Studio: performance, calendar, notifications, site controls,
// social captions, weekly report and team keys. Everything runs on free tools.
import { useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { captionsFor } from '../lib/captions.ts'
import { formatDate, formatDateTime } from '../lib/format.ts'
import { invalidate, useAsync } from '../lib/hooks.ts'
import { hasFullAccess, ownerRole, registerOwnerDevice, studio, studioPost } from '../lib/owner.ts'
import { smartLink } from '../lib/stats.ts'
import { fetchPost, fetchPosts, type Post } from '../lib/wp.ts'

export function Panel({ title, note, children, actions }: { title: string; note?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {actions}
      </div>
      {note && <p className="panel-note">{note}</p>}
      {children}
    </section>
  )
}

const copy = async (text: string, label = 'Copied') => {
  try {
    await navigator.clipboard.writeText(text)
    toast(label)
  } catch {
    toast('Could not copy')
  }
}

function useLatestStories() {
  return useAsync('studio:latest15', (s) => fetchPosts({ perPage: 15 }, s))
}

/* ---------- Add to calendar (used from other tabs too) ---------- */
export function AddToCalendar({ title, source }: { title: string; source?: string }) {
  const [done, setDone] = useState(false)
  const add = async () => {
    try {
      const r = await studioPost<{ ok: boolean; error?: string }>('calendar', { title, source: source ?? '', status: 'idea' })
      if (!r.ok) throw new Error(r.error)
      invalidate('studio:calendar')
      setDone(true)
      toast('Added to the content calendar')
    } catch (e) {
      toast((e as Error).message || 'Could not add')
    }
  }
  return (
    <button className={`mini-btn ${done ? 'done' : ''}`} onClick={add} disabled={done} aria-label={`Add “${title}” to the calendar`}>
      <Icon name={done ? 'bookmark' : 'sparkle'} size={13} /> {done ? 'In calendar' : 'Plan it'}
    </button>
  )
}

/* ---------- #6 Performance ---------- */
interface Perf {
  days: number
  stories: { id: number; title: string; link: string | null; opens: number; share: number; whatsapp: number; copy: number }[]
}
export function PerformanceTab() {
  const [days, setDays] = useState(7)
  const res = useAsync(`studio:perf:${days}`, (s) => studio<Perf>(`performance?days=${days}`, undefined, s))
  return (
    <>
      <div className="segmented small" role="radiogroup" aria-label="Period">
        {[1, 7, 30].map((d) => (
          <button key={d} role="radio" aria-checked={days === d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
            {d === 1 ? 'Today' : `${d} days`}
          </button>
        ))}
      </div>
      <Panel title="Story performance in the app" note="Reads and shares counted anonymously in the app (share sheet, WhatsApp, copied link).">
        {res.error && !res.data ? (
          <ErrorState error={res.error} onRetry={res.reload} />
        ) : !res.data ? (
          <SkeletonList count={4} />
        ) : res.data.stories.length === 0 ? (
          <p className="empty">No reads recorded in this period yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="score-table perf">
              <thead>
                <tr>
                  <th>Story</th>
                  <th>Reads</th>
                  <th>Shares</th>
                  <th>WhatsApp</th>
                  <th>Copied</th>
                </tr>
              </thead>
              <tbody>
                {res.data.stories.map((s) => (
                  <tr key={s.id}>
                    <td className="perf-title">
                      <a href={`#/article/${s.id}`}>{s.title}</a>
                    </td>
                    <td>{s.opens}</td>
                    <td>{s.share}</td>
                    <td>{s.whatsapp}</td>
                    <td>{s.copy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

/* ---------- #8 Calendar ---------- */
interface Idea {
  id: number
  title: string
  notes: string | null
  status: 'idea' | 'writing' | 'published'
  due: string | null
  source: string | null
  created_by: string | null
}
const STATUS_LABEL = { idea: 'Idea', writing: 'Writing', published: 'Published' } as const
const NEXT = { idea: 'writing', writing: 'published', published: 'idea' } as const

export function CalendarTab() {
  const res = useAsync('studio:calendar', (s) => studio<{ items: Idea[] }>('calendar', undefined, s))
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (body: Partial<Idea> & { title: string }) => {
    const r = await studioPost<{ ok: boolean; error?: string }>('calendar', body)
    if (!r.ok) throw new Error(r.error)
    invalidate('studio:calendar')
    res.reload()
  }
  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    try {
      await save({ title, due: due || null, status: 'idea' })
      setTitle('')
      setDue('')
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: number) => {
    await studioPost('calendar/delete', { id })
    res.reload()
  }
  const items = res.data?.items ?? []
  return (
    <>
      <Panel title="Add a story idea" note="Shared with everyone who has a Studio key. Tip: use “Plan it” on ideas in other tabs.">
        <form className="cal-form" onSubmit={add}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Jewar airport: what changes for Noida buyers" aria-label="Idea title" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
          <button className="btn small" disabled={busy || !title.trim()}>
            Add
          </button>
        </form>
      </Panel>
      {res.error && !res.data ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <SkeletonList count={3} />
      ) : (
        (['writing', 'idea', 'published'] as const).map((st) => {
          const list = items.filter((i) => i.status === st)
          return (
            <Panel key={st} title={`${STATUS_LABEL[st]} · ${list.length}`}>
              {list.length === 0 ? (
                <p className="empty">Nothing here.</p>
              ) : (
                <ul className="cal-list">
                  {list.map((i) => (
                    <li key={i.id} className={i.due && i.due < new Date().toISOString().slice(0, 10) && st !== 'published' ? 'overdue' : ''}>
                      <div>
                        <strong>{i.title}</strong>
                        <span className="meta">
                          {i.due ? `Due ${formatDate(`${i.due}T12:00:00Z`)}` : 'No date'}
                          {i.created_by ? ` · by ${i.created_by}` : ''}
                          {i.source?.startsWith('http') && (
                            <>
                              {' · '}
                              <a href={i.source} target="_blank" rel="noopener noreferrer">
                                source
                              </a>
                            </>
                          )}
                        </span>
                      </div>
                      <div className="cal-actions">
                        <button className="mini-btn" onClick={() => save({ ...i, status: NEXT[i.status] }).catch((e) => toast(e.message))}>
                          → {STATUS_LABEL[NEXT[i.status]]}
                        </button>
                        <button className="icon-btn" onClick={() => remove(i.id)} aria-label={`Delete ${i.title}`}>
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )
        })
      )}
    </>
  )
}

/* ---------- #1 Notify readers ---------- */
interface PushLog {
  log: { ts: string; title: string; body: string; url: string; by_name: string; sent: number }[]
  left: number
}
export function NotifyTab() {
  const log = useAsync('studio:pushlog', (s) => studio<PushLog>('push-log', undefined, s))
  const stories = useLatestStories()
  const [title, setTitle] = useState('R&M News')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const useStory = (p: Post) => {
    setTitle('R&M News')
    setBody(p.title)
    setLink(p.link)
  }
  const send = async () => {
    if (!armed) return setArmed(true)
    setBusy(true)
    try {
      const r = await studioPost<{ ok: boolean; error?: string; sent?: number; left?: number }>('push', { title, body, url: link })
      if (!r.ok) throw new Error(r.error)
      toast(`Sent to ${r.sent} device(s). ${r.left} left today.`)
      setBody('')
      setLink('')
      log.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
      setArmed(false)
    }
  }
  return (
    <>
      <Panel title="Send a notification to all readers" note={`Goes to everyone who turned on alerts. ${log.data ? `${log.data.left} of 5 left today.` : ''} Use it for big stories only.`}>
        <div className="form-grid">
          <label>
            Title
            <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Message
            <textarea value={body} maxLength={180} rows={3} onChange={(e) => (setBody(e.target.value), setArmed(false))} placeholder="e.g. Exclusive: DLF CEO on luxury demand" />
          </label>
          <label>
            Story link (realtynmore.com) <small>optional</small>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://realtynmore.com/…" />
          </label>
        </div>
        <div className="push-preview" aria-label="Preview">
          <img src="./icons/icon-192.png" alt="" width={36} height={36} />
          <div>
            <strong>{title || 'R&M News'}</strong>
            <span>{body || 'Your message'}</span>
          </div>
        </div>
        <div className="action-row">
          <button className={`btn ${armed ? 'danger' : ''}`} onClick={send} disabled={busy || !body.trim() || log.data?.left === 0}>
            <Icon name="bell" size={16} /> {busy ? 'Sending…' : armed ? 'Tap again to send to all' : 'Send notification'}
          </button>
          {armed && (
            <button className="btn ghost" onClick={() => setArmed(false)}>
              Cancel
            </button>
          )}
        </div>
      </Panel>
      <Panel title="Quick pick: latest stories">
        <ul className="pick-list">
          {(stories.data?.posts ?? []).slice(0, 8).map((p) => (
            <li key={p.id}>
              <button className="link-row" onClick={() => useStory(p)}>
                {p.title}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Sent recently">
        {log.data?.log.length ? (
          <ul className="idea-list">
            {log.data.log.map((l) => (
              <li key={l.ts}>
                <strong>{l.body}</strong>
                <span className="meta">
                  {formatDateTime(l.ts)} · by {l.by_name} · {l.sent} device(s)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">Nothing sent yet.</p>
        )}
      </Panel>
    </>
  )
}

/* ---------- #2 Editor's Pick, #3 banner, #4 uptime, #5 brief ---------- */
interface SiteCfg {
  pin: { postId: number; until: string | null } | null
  banner: { id: string; text: string; link: string; until: string | null; tone: 'accent' | 'dark' } | null
}
interface Uptime {
  now: { down: boolean; fails: number; since: string | null }
  uptime7: number | null
  days: { day: string; checks: number; up: number; avg_ms: number }[]
  incidents: { ts: string; status: number; ms: number }[]
  ownerDevices: number
}
export function SiteTab() {
  const cfg = useAsync('studio:site', (s) => studio<SiteCfg>('site', undefined, s))
  const up = useAsync('studio:uptime', (s) => studio<Uptime>('uptime', undefined, s))
  const stories = useLatestStories()
  const [pinId, setPinId] = useState('')
  const [pinUntil, setPinUntil] = useState('')
  const [bText, setBText] = useState('')
  const [bLink, setBLink] = useState('')
  const [bUntil, setBUntil] = useState('')
  const [bTone, setBTone] = useState<'accent' | 'dark'>('accent')
  const isOwner = hasFullAccess()

  const saveCfg = async (body: unknown, done: string) => {
    try {
      const r = await studioPost<{ ok: boolean; error?: string }>('site', body)
      if (!r.ok) throw new Error(r.error)
      invalidate('site:config')
      cfg.reload()
      toast(done)
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:00+05:30`).toISOString() : null)
  const pinId0 = cfg.data?.pin?.postId
  const pinnedPost = useAsync(pinId0 ? `pick:${pinId0}` : null, (s) => fetchPost(String(pinId0), s))
  const pinned = stories.data?.posts.find((p) => p.id === pinId0) ?? pinnedPost.data ?? undefined

  return (
    <>
      <Panel title="Editor’s Pick on Home" note="Shows one story at the top of Home for every reader.">
        {cfg.data?.pin && (
          <p className="current">
            Now pinned: <b>{pinned?.title ?? `Story ${cfg.data.pin.postId}`}</b>
            {cfg.data.pin.until ? ` · until ${formatDateTime(cfg.data.pin.until)}` : ''}{' '}
            <button className="mini-btn" onClick={() => saveCfg({ pin: null }, 'Editor’s Pick removed')}>
              Remove
            </button>
          </p>
        )}
        <div className="form-grid">
          <label>
            Story
            <select value={pinId} onChange={(e) => setPinId(e.target.value)}>
              <option value="">Choose a recent story…</option>
              {(stories.data?.posts ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title.slice(0, 90)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Until <small>optional</small>
            <input type="date" value={pinUntil} onChange={(e) => setPinUntil(e.target.value)} />
          </label>
        </div>
        <button className="btn small" disabled={!pinId} onClick={() => saveCfg({ pin: { postId: Number(pinId), until: endOfDay(pinUntil) } }, 'Editor’s Pick is live')}>
          Pin story
        </button>
      </Panel>

      <Panel title="Announcement banner" note="A one-line banner under the header for every reader (events, magazine issue, webinars).">
        {cfg.data?.banner && (
          <p className="current">
            Live: <b>{cfg.data.banner.text}</b>
            {cfg.data.banner.until ? ` · until ${formatDateTime(cfg.data.banner.until)}` : ''}{' '}
            <button className="mini-btn" onClick={() => saveCfg({ banner: null }, 'Banner removed')}>
              Remove
            </button>
          </p>
        )}
        <div className="form-grid">
          <label>
            Text
            <input value={bText} maxLength={140} onChange={(e) => setBText(e.target.value)} placeholder="e.g. R&M Podium 2026 · 5 Nov, New Delhi · Register now" />
          </label>
          <label>
            Link <small>optional, https://…</small>
            <input value={bLink} onChange={(e) => setBLink(e.target.value)} placeholder="https://realtynmore.com/…" />
          </label>
          <label>
            Until <small>optional</small>
            <input type="date" value={bUntil} onChange={(e) => setBUntil(e.target.value)} />
          </label>
          <label>
            Style
            <select value={bTone} onChange={(e) => setBTone(e.target.value as 'accent' | 'dark')}>
              <option value="accent">Orange</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
        <div className={`announce ${bTone} preview`}>
          <span className="announce-body">
            <Icon name="sparkle" size={16} /> <span>{bText || 'Banner preview'}</span>
          </span>
        </div>
        <button className="btn small" disabled={!bText.trim()} onClick={() => saveCfg({ banner: { text: bText, link: bLink, until: endOfDay(bUntil), tone: bTone } }, 'Banner is live')}>
          Publish banner
        </button>
      </Panel>

      <Panel title="Website uptime" note="realtynmore.com is checked every 10 minutes. Owner devices get an alert if it’s down for 20 minutes, and again when it’s back.">
        {up.error && !up.data ? (
          <ErrorState error={up.error} onRetry={up.reload} />
        ) : !up.data ? (
          <SkeletonList count={2} />
        ) : (
          <>
            <div className="kpis">
              <div className={`kpi ${up.data.now.down ? 'warn' : ''}`}>
                <b>{up.data.now.down ? 'DOWN' : 'Up'}</b>
                <span>Right now</span>
              </div>
              <div className="kpi">
                <b>{up.data.uptime7 === null ? '–' : `${up.data.uptime7}%`}</b>
                <span>Uptime · 7 days</span>
              </div>
              <div className="kpi">
                <b>{up.data.days[0]?.avg_ms ? `${(up.data.days[0].avg_ms / 1000).toFixed(1)}s` : '–'}</b>
                <span>Avg response today</span>
              </div>
            </div>
            {up.data.incidents.length > 0 && (
              <ul className="idea-list">
                {up.data.incidents.map((i) => (
                  <li key={i.ts}>
                    <span>Failed check · {i.status ? `HTTP ${i.status}` : 'no response'}</span>
                    <span className="meta">{formatDateTime(i.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="panel-note">{up.data.ownerDevices} owner device(s) receive alerts.</p>
          </>
        )}
      </Panel>

      <Panel title="Owner alerts on this phone" note="Website-down alerts and the 9 AM morning brief (yesterday’s reads, top story, uptime, search gaps).">
        <div className="action-row">
          <button
            className="btn small"
            onClick={async () => {
              try {
                const r = await registerOwnerDevice()
                toast(r === 'ok' ? 'This device will get owner alerts' : r === 'denied' ? 'Allow notifications first' : 'This browser can’t receive alerts')
                up.reload()
              } catch (e) {
                toast((e as Error).message)
              }
            }}
          >
            <Icon name="bell" size={16} /> Get owner alerts here
          </button>
          {isOwner && (
            <button
              className="btn ghost small"
              onClick={async () => {
                try {
                  const r = await studioPost<{ result: string }>('brief-now', {})
                  toast(r.result)
                } catch (e) {
                  toast((e as Error).message)
                }
              }}
            >
              Send morning brief now
            </button>
          )}
        </div>
      </Panel>
    </>
  )
}

/* ---------- #7 Social captions ---------- */
export function CaptionsTab() {
  const stories = useLatestStories()
  const [id, setId] = useState<number | null>(null)
  const posts = stories.data?.posts ?? []
  const post = posts.find((p) => p.id === id) ?? posts[0]
  if (stories.error && !stories.data) return <ErrorState error={stories.error} onRetry={stories.reload} />
  if (!post) return <SkeletonList count={3} />
  const c = captionsFor(post, smartLink(post))
  const blocks: { key: keyof typeof c; label: string; note: string }[] = [
    { key: 'instagram', label: 'Instagram', note: 'Put the story link in bio or a story sticker.' },
    { key: 'linkedin', label: 'LinkedIn', note: 'The link shows a photo-and-title preview.' },
    { key: 'x', label: 'X (Twitter)', note: 'Fits 280 characters.' },
    { key: 'whatsapp', label: 'WhatsApp', note: 'Bold title and preview link.' },
  ]
  return (
    <>
      <Panel title="Pick a story">
        <select className="wide-select" value={post.id} onChange={(e) => setId(Number(e.target.value))} aria-label="Story">
          {posts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title.slice(0, 100)}
            </option>
          ))}
        </select>
        <p className="panel-note">Captions use only the story’s own title and summary, with up to 5 hashtags.</p>
      </Panel>
      {blocks.map((b) => (
        <Panel
          key={b.key}
          title={b.label}
          note={b.note}
          actions={
            <button className="mini-btn" onClick={() => copy(c[b.key], `${b.label} caption copied`)}>
              Copy
            </button>
          }
        >
          <pre className="caption-box">{c[b.key]}</pre>
        </Panel>
      ))}
    </>
  )
}

/* ---------- #9 Weekly report ---------- */
interface Overview {
  subscribers: number
  views7: number
  opens7: number
  topArticles: { id: number; opens: number; title: string }[]
  searches: { q: string; n: number }[]
  zeroSearches: { q: string; n: number }[]
}
interface Rivals {
  sources: { name: string; perDay: number }[]
  advice: { kind: string; text: string }[]
}
export function ReportTab() {
  const ov = useAsync('studio:overview', (s) => studio<Overview>('overview', undefined, s))
  const perf = useAsync('studio:perf:7', (s) => studio<Perf>('performance?days=7', undefined, s))
  const up = useAsync('studio:uptime', (s) => studio<Uptime>('uptime', undefined, s))
  const seo = useAsync('studio:seo', (s) => studio<{ average: number }>('seo', undefined, s))
  const rivals = useAsync('studio:rivals', (s) => studio<Rivals>('competitors', undefined, s))
  const today = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  const shares = perf.data?.stories.reduce((a, s) => a + s.share + s.whatsapp + s.copy, 0)
  return (
    <div className="report">
      <div className="report-head">
        <div>
          <span className="owner-badge">Weekly report</span>
          <h2>R&amp;M News app · week ending {today}</h2>
        </div>
        <button className="btn small no-print" onClick={() => window.print()}>
          <Icon name="download" size={16} /> Print / Save PDF
        </button>
      </div>
      <div className="kpis">
        <div className="kpi">
          <b>{ov.data?.views7 ?? '…'}</b>
          <span>Screen views</span>
        </div>
        <div className="kpi">
          <b>{ov.data?.opens7 ?? '…'}</b>
          <span>Stories read</span>
        </div>
        <div className="kpi">
          <b>{shares ?? '…'}</b>
          <span>Shares</span>
        </div>
        <div className="kpi">
          <b>{ov.data?.subscribers ?? '…'}</b>
          <span>Alert subscribers</span>
        </div>
        <div className="kpi">
          <b>{up.data?.uptime7 != null ? `${up.data.uptime7}%` : '…'}</b>
          <span>Website uptime</span>
        </div>
        <div className="kpi">
          <b>{seo.data ? `${seo.data.average}/100` : '…'}</b>
          <span>SEO score (latest 15)</span>
        </div>
      </div>
      <Panel title="Most read in the app">
        <ol className="rank">
          {(ov.data?.topArticles ?? []).slice(0, 10).map((a) => (
            <li key={a.id}>
              {a.title}
              <span>{a.opens}</span>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title="Most shared">
        <ol className="rank">
          {[...(perf.data?.stories ?? [])]
            .sort((a, b) => b.share + b.whatsapp + b.copy - (a.share + a.whatsapp + a.copy))
            .filter((s) => s.share + s.whatsapp + s.copy > 0)
            .slice(0, 5)
            .map((s) => (
              <li key={s.id}>
                {s.title}
                <span>{s.share + s.whatsapp + s.copy}</span>
              </li>
            ))}
        </ol>
      </Panel>
      <Panel title="What readers searched for">
        <p>{(ov.data?.searches ?? []).slice(0, 12).map((s) => `${s.q} (${s.n})`).join(', ') || 'No searches yet.'}</p>
        {ov.data?.zeroSearches.length ? <p className="panel-note">No results for: {ov.data.zeroSearches.map((s) => s.q).join(', ')}</p> : null}
      </Panel>
      <Panel title="Competitors and next steps">
        <p className="panel-note">{rivals.data?.sources.map((s) => `${s.name}: ${s.perDay}/day`).join(' · ')}</p>
        <ul className="issues">
          {(rivals.data?.advice ?? []).map((a, i) => (
            <li key={i}>{a.text}</li>
          ))}
        </ul>
      </Panel>
      <p className="panel-note">All numbers come from the app’s anonymous counts, realtynmore.com and public competitor feeds.</p>
    </div>
  )
}

/* ---------- #10 Team keys ---------- */
interface Editor {
  id: string
  name: string
  created: string
  lastUsed?: string
  admin?: boolean
}
export function TeamTab() {
  const res = useAsync('studio:team', (s) => studio<{ editors: Editor[] }>('team', undefined, s))
  const [name, setName] = useState('')
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null)
  const iAmOwner = ownerRole()?.role === 'owner'
  if (!hasFullAccess()) return <p className="empty">Only the owner can manage team keys.</p>
  const setAccess = async (e: Editor, admin: boolean) => {
    if (admin && !window.confirm(`Give ${e.name} full access? They will see everything you see: business numbers, traffic, team, attendance and settings.`)) return
    try {
      await studioPost('team/access', { id: e.id, admin })
      toast(admin ? `${e.name} now has full access` : `${e.name} is back to team access`)
      res.reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }
  const create = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const r = await studioPost<{ key: string; editor: Editor }>('team', { name })
      setNewKey({ name: r.editor.name, key: r.key })
      setName('')
      res.reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }
  const revoke = async (id: string) => {
    await studioPost('team/revoke', { id })
    toast('Key revoked')
    res.reload()
  }
  return (
    <>
      <Panel title="Add a team member" note="Give each employee their own login key. Team logins get the writing, publishing, reel-script and magazine tools plus their own My day (check-in and daily report). Owner sections (overview, website traffic, performance, team, attendance, notifications, site settings) stay with your login only. You can remove a key anytime; never share your owner key.">
        <form className="cal-form" onSubmit={create}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Neha (desk)" aria-label="Team member name" />
          <button className="btn small" disabled={!name.trim()}>
            Create key
          </button>
        </form>
        {newKey && (
          <div className="new-key">
            <p>
              Key for <b>{newKey.name}</b>. Copy it now; it won’t be shown again.
            </p>
            <code>{newKey.key}</code>
            <button className="mini-btn" onClick={() => copy(newKey.key, 'Key copied')}>
              Copy key
            </button>
          </div>
        )}
      </Panel>
      <Panel title="Team keys">
        {!res.data ? (
          <SkeletonList count={2} />
        ) : res.data.editors.length === 0 ? (
          <p className="empty">No team keys yet.</p>
        ) : (
          <ul className="cal-list">
            {res.data.editors.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>
                    {e.name} {e.admin && <span className="acct-tag">Full access</span>}
                  </strong>
                  <span className="meta">
                    Created {formatDate(e.created)} · {e.lastUsed ? `last used ${formatDateTime(e.lastUsed)}` : 'not used yet'}
                  </span>
                </div>
                <div className="acct-btns">
                  {iAmOwner && (
                    <button className="mini-btn" onClick={() => setAccess(e, !e.admin)}>
                      {e.admin ? 'Team access' : 'Give full access'}
                    </button>
                  )}
                  {(iAmOwner || !e.admin) && (
                    <button className="mini-btn danger" onClick={() => revoke(e.id)}>
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
