// Studio → Manage → Employees (owner and full access): everyone with a mobile login, their role,
// shift and status; add an employee, reset a password, give or remove full access, remove.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { PersonAvatar } from '../components/PersonAvatar.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDateTime } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { ownerRole, studio, studioPost } from '../lib/owner.ts'

interface Account {
  phone: string
  name: string
  role: 'owner' | 'admin' | 'editor'
  status: 'pending' | 'active' | 'rejected'
  created: string
  lastLogin: string | null
  lastSeen?: string | null
  devices?: number
  mustChange?: boolean
  title?: string
  photo?: string
  avatar?: string
}
interface Settings {
  startTime: string
  endTime: string
  people: Record<string, { start?: string; end?: string }>
}
const showPhone = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`

/** "Online now", "12 min ago", "Today 4:12 pm", "Yesterday", "3 days ago". */
export function seenLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Never'
  const t = Date.parse(iso)
  const mins = Math.round((now - t) / 60000)
  if (mins < 6) return 'Online now'
  if (mins < 60) return `${mins} min ago`
  const ist = (ms: number) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10)
  if (ist(t) === ist(now)) return `Today ${new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(t))}`
  if (ist(t) === ist(now - 86400000)) return 'Yesterday'
  const days = Math.round((now - t) / 86400000)
  return days < 30 ? `${days} days ago` : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(t))
}
const APP = 'https://realty-more.github.io/rnm-news/#/studio'
const loginMessage = (name: string, phone: string, password: string) =>
  `Hi ${name.split(' ')[0]}, your Realtynmore app login:\nMobile: ${phone}\nTemporary password: ${password}\nOpen: ${APP}\nOn first login you will set your own password.`

/** A centred dialog (a sheet from the bottom on phones). Escape or the backdrop closes it. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="dlg-scrim" onClick={onClose}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Shows a new login once, with copy and WhatsApp buttons. */
function LoginCard({ name, phone, password, onDone }: { name: string; phone: string; password: string; onDone: () => void }) {
  const msg = loginMessage(name, phone, password)
  return (
    <div className="login-card">
      <p className="login-card-ok">✓ {name} can now log in</p>
      <dl>
        <dt>Mobile number</dt>
        <dd>{showPhone(phone)}</dd>
        <dt>Temporary password</dt>
        <dd>
          <code>{password}</code>
        </dd>
      </dl>
      <p className="meta">Shown only once. On first login they choose their own password.</p>
      <div className="action-row">
        <a className="btn small" href={`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer">
          Send on WhatsApp
        </a>
        <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(msg).then(() => toast('Login message copied'))}>
          Copy message
        </button>
        <button className="btn ghost small" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )
}

/** Add employee: name, mobile, designation, office time and access, in one form. */
export function AddEmployeeDialog({ onClose, onAdded, office }: { onClose: () => void; onAdded: () => void; office?: { start: string; end: string } }) {
  const [f, setF] = useState({ name: '', phone: '', title: '', start: '', end: '', admin: false })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ name: string; phone: string; password: string } | null>(null)
  const isOwner = ownerRole()?.role === 'owner' || ownerRole()?.role === 'admin'
  const endBeforeStart = !!f.end && f.end <= (f.start || office?.start || '00:00')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await studioPost<{ name: string; phone: string; password: string }>('accounts/add', { ...f, start: f.start || undefined, end: f.end || undefined })
      setDone(r)
      onAdded()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={done ? 'Employee added' : 'Add employee'} onClose={onClose}>
      {done ? (
        <LoginCard {...done} onDone={onClose} />
      ) : (
        <form className="emp-form" onSubmit={submit}>
          <label>
            Full name
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Vimal Singh" maxLength={40} autoFocus required />
          </label>
          <label>
            Mobile number
            <span className="phone-field">
              <span>+91</span>
              <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[^\d ]/g, '').slice(0, 12) })} placeholder="10-digit mobile" inputMode="numeric" required />
            </span>
          </label>
          <label>
            Designation <small>(optional)</small>
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Video Editor" maxLength={60} />
          </label>
          <div className="emp-times">
            <label>
              Office starts
              <input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
            </label>
            <label>
              Office ends
              <input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
            </label>
          </div>
          <p className={`meta ${endBeforeStart ? 'warn-text' : ''}`}>
            {endBeforeStart
              ? `End time is before start time. For 6 in the evening choose 6:00 PM (18:00).`
              : `Leave empty to use the office time${office ? ` (${office.start}–${office.end})` : ''}.`}
          </p>
          {isOwner && (
            <label className="auth-check">
              <input type="checkbox" checked={f.admin} onChange={(e) => setF({ ...f, admin: e.target.checked })} /> Full access (sees business numbers, team and settings)
            </label>
          )}
          <div className="action-row">
            <button className="btn" disabled={busy || endBeforeStart || f.name.trim().length < 2 || f.phone.replace(/\D/g, '').length < 10}>
              {busy ? 'Adding…' : 'Add employee'}
            </button>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

/** The "⋯" menu on each employee row. */
function RowMenu({ items }: { items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="row-menu" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="More actions">
        ⋯
      </button>
      {open && (
        <div className="row-menu-list" role="menu">
          {items.map((i) => (
            <button
              key={i.label}
              role="menuitem"
              className={i.danger ? 'danger' : ''}
              onClick={() => {
                setOpen(false)
                i.onClick()
              }}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function EmployeesTab() {
  const res = useAsync('studio:accounts', (s) => studio<{ accounts: Account[] }>('accounts', undefined, s))
  const settings = useAsync('studio:team-settings', (s) => studio<{ settings: Settings }>('team/settings', undefined, s))
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: string; danger?: boolean; run: () => Promise<void> } | null>(null)
  const [newPw, setNewPw] = useState<{ name: string; phone: string; password: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const me = ownerRole()
  const s = settings.data?.settings

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (res.data?.accounts ?? []).filter((a) => a.role !== 'owner' && a.status !== 'pending' && (!t || a.name.toLowerCase().includes(t) || a.phone.includes(t) || a.title?.toLowerCase().includes(t)))
  }, [res.data, q])
  const pending = (res.data?.accounts ?? []).filter((a) => a.status === 'pending')

  const act = (a: Account, action: string) =>
    run(async () => {
      const r = await studioPost<{ password?: string }>(`accounts/${action}`, { phone: a.phone })
      if (r.password) setNewPw({ name: a.name, phone: a.phone, password: r.password })
      else toast({ approve: `${a.name} can now log in`, reject: 'Request declined', remove: `${a.name} removed`, grant: `${a.name} now has full access`, ungrant: `${a.name} is back to team access`, signout: `${a.name} is logged out everywhere` }[action] ?? 'Done')
      res.reload()
    })
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }
  const shift = (a: Account) => {
    if (!s) return ''
    const p = s.people?.[`ph:${a.phone}`]
    return `${p?.start ?? s.startTime}–${p?.end ?? s.endTime}`
  }

  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data) return <SkeletonList count={3} />

  return (
    <div className="emp">
      <div className="emp-head">
        <div>
          <h2>Employees</h2>
          <p className="meta">
            {list.filter((a) => a.status === 'active').length} active · {list.filter((a) => a.devices && seenLabel(a.lastSeen) === 'Online now').length} online now · {list.filter((a) => a.devices).length} logged in
          </p>
        </div>
        <button className="btn" onClick={() => setAdding(true)}>
          + Add employee
        </button>
      </div>

      {pending.length > 0 && (
        <section className="emp-pending">
          <h3>Requests to join ({pending.length})</h3>
          {pending.map((a) => (
            <div key={a.phone} className="emp-row">
              <PersonAvatar name={a.name} size={40} />
              <div className="emp-main">
                <strong>{a.name}</strong>
                <span className="meta">
                  {showPhone(a.phone)} · asked {formatDateTime(a.created)}
                </span>
              </div>
              <div className="emp-actions">
                <button className="btn small" disabled={busy} onClick={() => void act(a, 'approve')}>
                  Approve
                </button>
                <button className="btn ghost small" disabled={busy} onClick={() => void act(a, 'reject')}>
                  Decline
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <input className="emp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile or designation" aria-label="Search employees" />

      {list.length === 0 ? (
        <p className="empty">{res.data.accounts.length ? 'Nobody matches.' : 'No employees yet. Tap “+ Add employee”.'}</p>
      ) : (
        <div className="emp-list">
          {list.map((a) => (
            <div key={a.phone} className={`emp-row ${a.status === 'rejected' ? 'off' : ''}`}>
              <PersonAvatar name={a.name} photo={a.photo} avatar={a.avatar} size={44} />
              <div className="emp-main">
                <strong>
                  {a.name} {a.role === 'admin' && <span className="acct-tag">Full access</span>}
                </strong>
                <span className="meta">{[a.title, showPhone(a.phone)].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="emp-cols">
                <span>
                  <small>Shift</small>
                  {shift(a) || '–'}
                </span>
                <span>
                  <small>Status</small>
                  {a.status === 'rejected' ? (
                    <em className="emp-status off">Declined</em>
                  ) : a.mustChange ? (
                    <em className="emp-status wait">Waiting for first login</em>
                  ) : (
                    <em className="emp-status ok">Active</em>
                  )}
                </span>
                <span>
                  <small>Login</small>
                  {seenLabel(a.lastSeen ?? a.lastLogin) === 'Online now' && a.devices ? (
                    <em className="emp-status online">● Online now</em>
                  ) : a.devices ? (
                    <em className="emp-status ok">Logged in{a.devices > 1 ? ` · ${a.devices} devices` : ''}</em>
                  ) : (
                    <em className="emp-status off">Not logged in</em>
                  )}
                </span>
                <span>
                  <small>Last seen</small>
                  {seenLabel(a.lastSeen ?? a.lastLogin)}
                </span>
              </div>
              <RowMenu
                items={[
                  {
                    label: 'New password',
                    onClick: () => setConfirm({ title: 'Set a new password?', text: `${a.name} will be logged out everywhere and get a temporary password to log in again.`, action: 'Set new password', run: () => act(a, 'reset') }),
                  },
                  ...(me?.role === 'owner' || me?.role === 'admin'
                    ? [
                        a.role === 'admin'
                          ? { label: 'Remove full access', onClick: () => void act(a, 'ungrant') }
                          : {
                              label: 'Give full access',
                              onClick: () => setConfirm({ title: `Give ${a.name} full access?`, text: 'They will see everything you see: business numbers, website traffic, the team, attendance and settings.', action: 'Give full access', run: () => act(a, 'grant') }),
                            },
                      ]
                    : []),
                  ...(a.devices
                    ? [
                        {
                          label: 'Log out from all devices',
                          onClick: () =>
                            setConfirm({
                              title: `Log ${a.name} out everywhere?`,
                              text: `They are logged in on ${a.devices} device${(a.devices ?? 0) > 1 ? 's' : ''}. They will need their mobile number and password to log in again. Use this if a phone is lost.`,
                              action: 'Log out everywhere',
                              run: () => act(a, 'signout'),
                            }),
                        },
                      ]
                    : []),
                  {
                    label: 'Remove employee',
                    danger: true,
                    onClick: () =>
                      setConfirm({
                        title: `Remove ${a.name}?`,
                        text: 'They can no longer log in and leave the team lists. Their past attendance, reports and leave stay in the records.',
                        action: 'Remove employee',
                        danger: true,
                        run: () => act(a, 'remove'),
                      }),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      {adding && <AddEmployeeDialog onClose={() => setAdding(false)} onAdded={res.reload} office={s ? { start: s.startTime, end: s.endTime } : undefined} />}
      {confirm && (
        <Dialog title={confirm.title} onClose={() => setConfirm(null)}>
          <p>{confirm.text}</p>
          <div className="action-row">
            <button className={`btn ${confirm.danger ? 'danger' : ''}`} disabled={busy} onClick={() => void confirm.run()}>
              {busy ? 'Working…' : confirm.action}
            </button>
            <button className="btn ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
      {newPw && (
        <Dialog title="New password" onClose={() => setNewPw(null)}>
          <LoginCard {...newPw} onDone={() => setNewPw(null)} />
        </Dialog>
      )}
    </div>
  )
}
