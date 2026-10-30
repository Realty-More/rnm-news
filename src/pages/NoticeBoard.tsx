// Notice board at the top of R&M Newsroom.
//   Team members: new notices pinned as cards; "Got it" marks them seen and tucks them away.
//   Owner / full access: "📢 New notice" (phones get a notification), each notice shows "Seen by 3/5"
//   with who has and hasn't seen it, and can be removed.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from '../components/Toast.tsx'
import { useAsync } from '../lib/hooks.ts'
import { studio, studioPost } from '../lib/owner.ts'
import { Dialog } from './EmployeesTools.tsx'

interface Notice {
  id: number
  title: string
  body: string
  urgent: boolean
  by: string
  at: string
  expires: string | null
  seenByMe: boolean
  seen?: { name: string; at: string }[]
  notSeen?: string[]
  total?: number
}

const when = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })

export function NoticeBoard({ isFull }: { isFull: boolean }) {
  const res = useAsync('studio:notices', (s) => studio<{ notices: Notice[] }>('notices', undefined, s))
  const [writing, setWriting] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [openSeen, setOpenSeen] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const reload = useRef(res.reload)
  reload.current = res.reload
  // Fresh notices when the app comes back to the screen.
  useEffect(() => {
    const on = () => document.visibilityState === 'visible' && reload.current()
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  const all = res.data?.notices ?? []
  const fresh = all.filter((n) => !n.seenByMe)
  const shown = isFull || showAll ? all : fresh
  const gotIt = async (n: Notice) => {
    try {
      await studioPost('notices/seen', { id: n.id })
      res.reload()
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const remove = async (n: Notice) => {
    if (!window.confirm(`Remove the notice “${n.title}”? It disappears for everyone.`)) return
    setBusy(true)
    try {
      await studioPost('notices/delete', { id: n.id })
      toast('Notice removed')
      res.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!isFull && !all.length) return null
  return (
    <section className="nb" aria-label="Notice board">
      {(isFull || (!fresh.length && all.length > 0)) && (
        <div className="nb-bar">
          <span className="nb-bar-title">
            📌 Notice board{all.length ? ` · ${all.length}` : ''}
          </span>
          {!isFull && (
            <button className="link-btn" onClick={() => setShowAll((o) => !o)}>
              {showAll ? 'Hide' : 'View notices'}
            </button>
          )}
          {isFull && (
            <button className="btn small" onClick={() => setWriting(true)}>
              📢 New notice
            </button>
          )}
        </div>
      )}
      {shown.map((n, i) => (
        <article key={n.id} className={`nb-card ${n.urgent ? 'urgent' : ''}`} style={{ animationDelay: `${i * 0.06}s` }}>
          <div className="nb-top">
            <span className="nb-pin" aria-hidden="true">
              {n.urgent ? '🔴' : '📢'}
            </span>
            <div className="nb-text">
              <b>{n.title}</b>
              {n.body && <p>{n.body}</p>}
              <small>
                {n.by} · {when(n.at)}
                {n.expires ? ` · until ${new Date(n.expires).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}` : ''}
              </small>
            </div>
          </div>
          <div className="nb-actions">
            {isFull && n.total !== undefined && (
              <button className="nb-seen" onClick={() => setOpenSeen((o) => (o === n.id ? null : n.id))} aria-expanded={openSeen === n.id}>
                <span className="nb-seen-bar" aria-hidden="true">
                  <i style={{ width: `${n.total ? Math.round(((n.seen?.length ?? 0) / n.total) * 100) : 0}%` }} />
                </span>
                Seen by {n.seen?.length ?? 0}/{n.total}
              </button>
            )}
            {!n.seenByMe && (
              <button className="btn small" onClick={() => void gotIt(n)}>
                Got it
              </button>
            )}
            {isFull && (
              <button className="link-btn danger-text" disabled={busy} onClick={() => void remove(n)}>
                Remove
              </button>
            )}
          </div>
          {isFull && openSeen === n.id && (
            <div className="nb-who">
              {(n.seen ?? []).map((s) => (
                <span key={s.name} className="nb-chip ok">
                  ✓ {s.name} <em>{clock(s.at)}</em>
                </span>
              ))}
              {(n.notSeen ?? []).map((name) => (
                <span key={name} className="nb-chip">
                  {name} · not yet
                </span>
              ))}
              {!n.total && <span className="meta">No team members yet.</span>}
            </div>
          )}
        </article>
      ))}
      {isFull && !all.length && <p className="meta nb-empty">No notices. Post one and every phone gets a notification.</p>}
      {writing && <NewNotice onClose={() => setWriting(false)} onSent={res.reload} />}
    </section>
  )
}

function NewNotice({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [f, setF] = useState({ title: '', body: '', urgent: false, days: '3' })
  const [busy, setBusy] = useState(false)
  const send = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await studioPost<{ sent: number }>('notices', { title: f.title, body: f.body, urgent: f.urgent, days: Number(f.days) })
      toast(`Notice posted${r.sent ? ` · sent to ${r.sent} phone${r.sent === 1 ? '' : 's'}` : ''}`)
      onSent()
      onClose()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title="New notice" onClose={onClose}>
      <form className="emp-form" onSubmit={send}>
        <label>
          Title
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Team meeting on Monday at 11 AM" maxLength={90} autoFocus required />
        </label>
        <label>
          Message <small>(optional)</small>
          <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={4} maxLength={800} placeholder="Details, place, what to bring…" />
        </label>
        <label>
          Show it for
          <select value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })}>
            <option value="1">1 day</option>
            <option value="3">3 days</option>
            <option value="7">1 week</option>
            <option value="30">1 month</option>
            <option value="0">Until I remove it</option>
          </select>
        </label>
        <label className="auth-check">
          <input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} /> Urgent (shown first, in red)
        </label>
        <p className="meta">Everyone’s phone gets a notification, and the notice stays pinned at the top of R&amp;M Newsroom.</p>
        <div className="action-row">
          <button className="btn" disabled={busy || f.title.trim().length < 3}>
            {busy ? 'Posting…' : 'Post notice'}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}
