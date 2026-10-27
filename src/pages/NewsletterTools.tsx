// Studio → Publish → Newsletter (owner and full access): subscribers, this week's preview, test and
// send, the schedule and sender details, and every issue sent.
import { useEffect, useMemo, useState } from 'react'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDate } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { studio, studioPost } from '../lib/owner.ts'
import { Panel } from './StudioTools.tsx'

interface Settings {
  auto: boolean
  day: number
  time: string
  fromName: string
  fromEmail: string
  replyTo: string
  address: string
  intro: string
  dailyCap: number
  choice: 'pick' | 'auto'
  showMagazine: boolean
  showVideo: boolean
  showMarket: boolean
}
interface Sub {
  id: number
  email: string
  name: string
  status: 'pending' | 'active' | 'unsubscribed'
  source: string
  created_at: string
  confirmed_at: string | null
}
interface Issue {
  id: number
  week: string
  subject: string
  status: 'sending' | 'sent'
  created_by: string
  created_at: string
  sent_at: string | null
  sent: number
}
interface Book {
  connected: boolean
  picks: number[]
  due: string
  settings: Settings
  counts: { active: number; pending: number; unsubscribed: number }
  sentToday: number
  subscribers: Sub[]
  issues: Issue[]
  week: string
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const STATUS: Record<Sub['status'], string> = { active: 'Subscribed', pending: 'Waiting to confirm', unsubscribed: 'Unsubscribed' }

export function NewsletterTab() {
  const res = useAsync('studio:newsletter', (s) => studio<Book>('newsletter', undefined, s))
  const [f, setF] = useState<Settings | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  // The test address is the user's choice; the last one used is remembered on this device.
  const [testTo, setTestTo] = useState(() => {
    try {
      return localStorage.getItem('rnm-nl-test') ?? ''
    } catch {
      return ''
    }
  })
  const [q, setQ] = useState('')
  const [show, setShow] = useState<'all' | Sub['status']>('all')
  const [add, setAdd] = useState({ email: '', name: '', consent: false })
  const [busy, setBusy] = useState('')
  useEffect(() => {
    if (res.data) setF(res.data.settings)
  }, [res.data])
  const d = res.data

  const subs = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (d?.subscribers ?? []).filter((s) => (show === 'all' || s.status === show) && (!t || s.email.includes(t) || s.name?.toLowerCase().includes(t)))
  }, [d, q, show])

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  if (res.error && !d) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!d || !f) return <SkeletonList count={3} />
  const thisWeek = d.issues.find((i) => i.week === d.week)
  // A copy cached on this device before an update may lack the newer fields.
  const dueMs = Date.parse(d.due ?? '')
  const dueLabel = Number.isNaN(dueMs)
    ? `${DAYS[f.day]} ${f.time}`
    : new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(dueMs))
  const waitingForPicks = !thisWeek && (f.choice ?? 'pick') === 'pick' && (d.picks ?? []).length === 0
  const growth30 = d.subscribers.filter((s) => s.status === 'active' && s.confirmed_at && Date.now() - Date.parse(s.confirmed_at) < 30 * 86400000).length

  const csv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [['Email', 'Name', 'Status', 'Source', 'Signed up', 'Confirmed'], ...subs.map((s) => [s.email, s.name, STATUS[s.status], s.source, s.created_at.slice(0, 10), s.confirmed_at?.slice(0, 10) ?? ''])]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `newsletter-subscribers-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="nl-studio">
      {!d.connected && (
        <Panel title="Connect email sending (one time)" note="Sign-ups are already being collected. They get their confirmation email as soon as sending is connected.">
          <ol className="nl-steps">
            <li>
              Create a free account at <b>brevo.com</b> with the company email (free plan: 300 emails a day).
            </li>
            <li>
              In Brevo → <b>Senders, domains</b>: add the domain <b>realtynmore.com</b> and add the DNS records it shows (website team / domain account). Then add and confirm the sender{' '}
              <b>{f.fromEmail}</b>.
            </li>
            <li>
              In Brevo → <b>SMTP &amp; API → API keys</b>: create a key.
            </li>
            <li>
              On the office laptop, in <code>news-app\push-worker</code>, run <code>npx wrangler secret put BREVO_API_KEY</code> and paste the key. Never share the key on WhatsApp or email.
            </li>
          </ol>
        </Panel>
      )}

      <div className="kpis">
        <div className="kpi">
          <b>{d.counts.active}</b>
          <span>Subscribers</span>
        </div>
        <div className="kpi">
          <b>{d.counts.pending}</b>
          <span>Waiting to confirm</span>
        </div>
        <div className="kpi">
          <b>+{growth30}</b>
          <span>New in 30 days</span>
        </div>
        <div className="kpi">
          <b>{d.counts.unsubscribed}</b>
          <span>Unsubscribed</span>
        </div>
        <div className={`kpi ${d.connected ? '' : 'warn'}`}>
          <b>{d.connected ? `${d.sentToday}/${f.dailyCap}` : 'Off'}</b>
          <span>{d.connected ? 'Emails sent today' : 'Sending not connected'}</span>
        </div>
      </div>

      {!thisWeek && <StoryPicker choice={f.choice ?? 'pick'} onSaved={res.reload} />}

      <Panel
        title={`This week’s issue (${d.week})`}
        note={
          thisWeek
            ? `${thisWeek.status === 'sent' ? 'Sent' : 'Sending now'}: ${thisWeek.sent} delivered so far.`
            : waitingForPicks
              ? `Waiting for you to pick the stories. Once picked, it goes out ${f.auto ? `on ${dueLabel}` : 'when you press Send now'}.`
              : f.auto
                ? `Goes out automatically on ${dueLabel} to every subscriber.`
                : 'Automatic sending is off. Use “Send now”.'
        }
      >
        <label className="nl-label">
          Editor’s note for this issue <small>(optional, appears at the top; cleared after sending)</small>
          <textarea value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} rows={3} maxLength={600} placeholder="e.g. This week: Diwali offers across NCR, and our new magazine issue is out." />
        </label>
        <div className="action-row">
          <button className="btn ghost small" disabled={busy === 'save'} onClick={() => run('save', async () => (await studioPost('newsletter/settings', { intro: f.intro }), toast('Note saved')))}>
            Save note
          </button>
          <button className="btn ghost small" disabled={busy === 'preview'} onClick={() => run('preview', async () => setPreview(await studio('newsletter/preview')))}>
            {busy === 'preview' ? 'Building…' : 'Preview'}
          </button>
        </div>
        {preview && (
          <div className="nl-preview">
            <p className="meta">
              Subject: <b>{preview.subject}</b>
            </p>
            <iframe title="Newsletter preview" srcDoc={preview.html} sandbox="" />
          </div>
        )}
        <div className="nl-test">
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} type="email" placeholder="Send a test to (email)" aria-label="Test email address" />
          <button
            className="btn ghost small"
            disabled={!d.connected || busy === 'test' || !testTo.includes('@')}
            onClick={() =>
              run('test', async () => {
                const to = testTo.trim()
                await studioPost('newsletter/test', { email: to })
                try {
                  localStorage.setItem('rnm-nl-test', to)
                } catch {
                  /* private mode */
                }
                toast(`Test sent to ${to}. Check the inbox (and spam) in a minute.`)
              })
            }
          >
            Send test
          </button>
          <button
            className="btn small"
            disabled={!d.connected || !!thisWeek || waitingForPicks || busy === 'send' || d.counts.active === 0}
            onClick={() =>
              window.confirm(`Send this week’s newsletter to ${d.counts.active} subscribers now?`) &&
              run('send', async () => {
                const r = await studioPost<{ note: string }>('newsletter/send-now', {})
                toast(r.note)
                res.reload()
              })
            }
          >
            Send now
          </button>
        </div>
      </Panel>

      <Panel title="Schedule and sender" note="Emails come from this name and address; replies go to the reply-to address.">
        <label className="set-row toggle">
          <span>
            Send automatically every week
            <small>At the day and time below, with the stories you picked.</small>
          </span>
          <input type="checkbox" checked={f.auto} onChange={(e) => setF({ ...f, auto: e.target.checked })} />
        </label>
        <div className="segmented nl-choice" role="radiogroup" aria-label="How stories are chosen">
          <button role="radio" aria-checked={f.choice === 'pick'} className={f.choice === 'pick' ? 'on' : ''} onClick={() => setF({ ...f, choice: 'pick' })}>
            We pick the stories
          </button>
          <button role="radio" aria-checked={f.choice === 'auto'} className={f.choice === 'auto' ? 'on' : ''} onClick={() => setF({ ...f, choice: 'auto' })}>
            Automatic (most read)
          </button>
        </div>
        <p className="meta">
          {f.choice === 'pick'
            ? 'Nothing is sent until the stories are picked. The owner gets a reminder 2 hours before the send time.'
            : 'If nobody picks, the week’s most-read stories go out on their own.'}
        </p>
        <div className="weekoff" role="group" aria-label="Boxes in the email">
          <span>Also include:</span>
          <label className="auth-check">
            <input type="checkbox" checked={f.showMarket} onChange={(e) => setF({ ...f, showMarket: e.target.checked })} /> Nifty Realty week
          </label>
          <label className="auth-check">
            <input type="checkbox" checked={f.showMagazine} onChange={(e) => setF({ ...f, showMagazine: e.target.checked })} /> Latest magazine
          </label>
          <label className="auth-check">
            <input type="checkbox" checked={f.showVideo} onChange={(e) => setF({ ...f, showVideo: e.target.checked })} /> Latest video
          </label>
        </div>
        <div className="form-grid nl-grid">
          <label>
            Day
            <select value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>
              {DAYS.map((dd, i) => (
                <option key={dd} value={i}>
                  {dd}
                </option>
              ))}
            </select>
          </label>
          <label>
            Time (IST)
            <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
          </label>
          <label>
            From name
            <input value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} maxLength={60} />
          </label>
          <label>
            From email <small>(verified in Brevo)</small>
            <input type="email" value={f.fromEmail} onChange={(e) => setF({ ...f, fromEmail: e.target.value })} />
          </label>
          <label>
            Reply-to email
            <input type="email" value={f.replyTo} onChange={(e) => setF({ ...f, replyTo: e.target.value })} />
          </label>
          <label>
            Daily limit <small>(free plan: 300)</small>
            <input type="number" min={10} value={f.dailyCap} onChange={(e) => setF({ ...f, dailyCap: Number(e.target.value) })} />
          </label>
          <label className="nl-wide">
            Office address <small>(shown in the footer, recommended)</small>
            <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={200} placeholder="Company postal address" />
          </label>
        </div>
        <div className="action-row">
          <button
            className="btn small"
            disabled={busy === 'settings'}
            onClick={() =>
              run('settings', async () => {
                await studioPost('newsletter/settings', f)
                toast('Newsletter settings saved')
                res.reload()
              })
            }
          >
            Save settings
          </button>
        </div>
      </Panel>

      <Panel
        title={`Subscribers (${d.subscribers.length})`}
        actions={
          <button className="mini-btn" onClick={csv}>
            Excel (CSV)
          </button>
        }
      >
        <div className="team-bar">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email or name" aria-label="Search subscribers" />
          <select className="wide-select" value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Status">
            <option value="all">Everyone</option>
            <option value="active">Subscribed</option>
            <option value="pending">Waiting to confirm</option>
            <option value="unsubscribed">Unsubscribed</option>
          </select>
        </div>
        <details className="nl-add">
          <summary>+ Add someone who asked for it</summary>
          <div className="nl-test">
            <input value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} type="email" placeholder="Email" aria-label="Email" />
            <input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="Name (optional)" aria-label="Name" />
          </div>
          <label className="auth-check">
            <input type="checkbox" checked={add.consent} onChange={(e) => setAdd({ ...add, consent: e.target.checked })} /> They asked to receive the newsletter (they still confirm by email)
          </label>
          <button
            className="btn small"
            disabled={!add.consent || !add.email.includes('@') || busy === 'add'}
            onClick={() =>
              run('add', async () => {
                const r = await studioPost<{ note: string }>('newsletter/subscriber', add)
                toast(r.note)
                setAdd({ email: '', name: '', consent: false })
                res.reload()
              })
            }
          >
            Add
          </button>
        </details>
        {subs.length === 0 ? (
          <p className="empty">{d.subscribers.length ? 'Nobody matches.' : 'No subscribers yet. The sign-up box is on the app’s Home and Settings.'}</p>
        ) : (
          <div className="table-wrap">
            <table className="score-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Since</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {subs.slice(0, 500).map((s) => (
                  <tr key={s.id}>
                    <td>{s.email}</td>
                    <td>{s.name}</td>
                    <td>
                      <span className={`task-tag ${s.status === 'active' ? 'done' : ''}`}>{STATUS[s.status]}</span>
                    </td>
                    <td>{formatDate(s.confirmed_at ?? s.created_at)}</td>
                    <td>
                      <button
                        className="mini-btn danger"
                        onClick={() =>
                          window.confirm(`Delete ${s.email} and its history? (For data deletion requests.)`) &&
                          run('rm', async () => {
                            await studioPost('newsletter/subscriber/remove', { id: s.id })
                            toast('Deleted')
                            res.reload()
                          })
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Past issues">
        {d.issues.length === 0 ? (
          <p className="empty">No issue sent yet.</p>
        ) : (
          <ul className="task-list">
            {d.issues.map((i) => (
              <li key={i.id}>
                <div>
                  <strong>{i.subject}</strong>
                  <span className="meta">
                    {' '}
                    · {i.week} · {i.status === 'sent' ? `sent to ${i.sent}` : `sending (${i.sent} so far)`} · {formatDate(i.created_at)} · by {i.created_by}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

interface Story {
  id: number
  title: string
  excerpt: string
  image?: string
  link?: string
  views?: number
  opens?: number
}
interface Candidates {
  week: string
  picks: number[]
  picked: Story[]
  top: Story[]
  latest: Story[]
}
const MAX_PICKS = 10

/** Choose and order this week's stories. The first one is the lead (big photo). Saved on every change. */
function StoryPicker({ choice, onSaved }: { choice: 'pick' | 'auto'; onSaved: () => void }) {
  const res = useAsync('studio:nl-candidates', (s) => studio<Candidates>('newsletter/candidates', undefined, s))
  const [picked, setPicked] = useState<Story[] | null>(null)
  const [view, setView] = useState<'top' | 'latest' | 'search'>('top')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Story[] | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (res.data && picked === null) setPicked(res.data.picked)
  }, [res.data, picked])

  const save = async (next: Story[]) => {
    setPicked(next)
    setSaving(true)
    try {
      await studioPost('newsletter/picks', { ids: next.map((p) => p.id) })
      onSaved()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const move = (i: number, by: number) => {
    if (!picked) return
    const next = [...picked]
    const [it] = next.splice(i, 1)
    next.splice(i + by, 0, it)
    void save(next)
  }
  const search = async () => {
    if (q.trim().length < 2) return
    setView('search')
    setFound(null)
    try {
      setFound((await studio<{ search: Story[] }>(`newsletter/candidates?q=${encodeURIComponent(q.trim())}`)).search)
    } catch (e) {
      toast((e as Error).message)
      setFound([])
    }
  }

  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data || !picked) return <SkeletonList count={2} />
  const ids = new Set(picked.map((p) => p.id))
  const list = view === 'top' ? res.data.top : view === 'latest' ? res.data.latest : (found ?? [])

  return (
    <Panel
      title={`Stories for this issue (${picked.length}/${MAX_PICKS})`}
      note={
        picked.length
          ? 'The first story is the lead, with a big photo. Use the arrows to change the order. Saved automatically.'
          : choice === 'pick'
            ? 'Nothing is sent until you pick the stories. Add 3 to 8 from the lists below.'
            : 'Automatic mode: if you don’t pick, the most-read stories of the week go out.'
      }
      actions={saving ? <span className="meta">Saving…</span> : undefined}
    >
      {picked.length > 0 && (
        <ol className="nl-picked">
          {picked.map((p, i) => (
            <li key={p.id}>
              {p.image && <img src={p.image} alt="" loading="lazy" />}
              <span className="nl-picked-title">
                {i === 0 && <em>Lead story</em>}
                {p.title}
              </span>
              <span className="nl-picked-btns">
                <button className="mini-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  ↑
                </button>
                <button className="mini-btn" disabled={i === picked.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  ↓
                </button>
                <button className="mini-btn danger" onClick={() => void save(picked.filter((x) => x.id !== p.id))} aria-label="Remove">
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="nl-pick-bar">
        <div className="segmented small" role="tablist" aria-label="Story list">
          <button role="tab" aria-selected={view === 'top'} className={view === 'top' ? 'on' : ''} onClick={() => setView('top')}>
            Most read this week
          </button>
          <button role="tab" aria-selected={view === 'latest'} className={view === 'latest' ? 'on' : ''} onClick={() => setView('latest')}>
            Latest
          </button>
        </div>
        <form
          className="nl-pick-search"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any story" aria-label="Search stories" />
          <button className="mini-btn">Search</button>
        </form>
      </div>
      {view === 'search' && !found ? (
        <SkeletonList count={2} />
      ) : list.length === 0 ? (
        <p className="empty">{view === 'top' ? 'No reading data for this week yet. Use Latest or Search.' : 'No stories found.'}</p>
      ) : (
        <ul className="nl-cands">
          {list.map((p) => (
            <li key={p.id}>
              {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="nl-noimg" />}
              <span className="nl-cand-text">
                <a href={p.link} target="_blank" rel="noopener noreferrer">
                  {p.title}
                </a>
                {(p.views || p.opens) && (
                  <small>
                    {p.views ? `${p.views.toLocaleString('en-IN')} website views` : ''}
                    {p.views && p.opens ? ' · ' : ''}
                    {p.opens ? `${p.opens} app reads` : ''}
                  </small>
                )}
              </span>
              <button className="mini-btn" disabled={ids.has(p.id) || picked.length >= MAX_PICKS} onClick={() => void save([...picked, p])}>
                {ids.has(p.id) ? 'Added' : '+ Add'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
