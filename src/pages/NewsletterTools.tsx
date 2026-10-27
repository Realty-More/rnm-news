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
  const [testTo, setTestTo] = useState('')
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
              In Brevo → <b>Senders, domains</b>: add the domain <b>realtynmore.com</b> and add the DNS records it shows (website team / domain account). Then add the sender{' '}
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

      <Panel
        title={`This week’s issue (${d.week})`}
        note={thisWeek ? `${thisWeek.status === 'sent' ? 'Sent' : 'Sending now'}: ${thisWeek.sent} delivered so far.` : f.auto ? `Goes out automatically on ${DAYS[f.day]} at ${f.time} IST to every subscriber.` : 'Automatic sending is off. Use “Send now”.'}
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
            onClick={() => run('test', async () => (await studioPost('newsletter/test', { email: testTo }), toast(`Test sent to ${testTo}`)))}
          >
            Send test
          </button>
          <button
            className="btn small"
            disabled={!d.connected || !!thisWeek || busy === 'send' || d.counts.active === 0}
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
            <small>Built from the week’s most-read stories, the latest magazine, video and Nifty Realty.</small>
          </span>
          <input type="checkbox" checked={f.auto} onChange={(e) => setF({ ...f, auto: e.target.checked })} />
        </label>
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
