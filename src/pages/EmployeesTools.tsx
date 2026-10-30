// Studio → Manage → Employees (owner and full access): everyone who can open the Newsroom, their role,
// shift and status. Two ways in:
//   • Give Newsroom access (recommended): the person makes a normal Realtynmore account (email, mobile or
//     Google) and the owner gives that account Employee or Full access. No passwords change hands.
//   • + Add employee (backup): a mobile login with a temporary password, as before.
// Reset a password, give or remove full access, log out everywhere, remove.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon.tsx'
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
  email?: string | null
  title?: string
  photo?: string
  avatar?: string
}
/** A normal Realtynmore account with Newsroom access. */
interface Linked {
  readerId: number
  personId: string
  name: string
  email: string
  phone: string
  google: boolean
  role: 'admin' | 'editor'
  by: string
  granted: string
  lastSeen: string
  /** "ph:<mobile>" when this account signs in as an existing team login (same person). */
  sameAs?: string
  title?: string
  photo?: string
  avatar?: string
}
interface Found {
  readerId: number
  name: string
  email: string
  phone: string
  google: boolean
  created: string
  access: 'admin' | 'editor' | null
  sameAs?: string
}
interface SameName {
  personId: string
  name: string
  phone: string
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
  `Hi ${name.split(' ')[0]}, your R&M Newsroom login (Realtynmore app):\nMobile: ${phone}\nTemporary password: ${password}\nOpen: ${APP}\nOn first login you will set your own password.`

/** Status pills under a person's name: presence, account status, shift and last seen. */
function EmpFacts({ presence, status = 'active', shift, seen }: { presence: { tone: 'online' | 'in' | 'out'; text: string }; status?: 'active' | 'pending' | 'declined'; shift: string; seen: string }) {
  return (
    <div className="emp-facts">
      {status === 'pending' ? (
        <span className="emp-pill pending">Awaiting first sign-in</span>
      ) : status === 'declined' ? (
        <span className="emp-pill out">Declined</span>
      ) : (
        <span className={`emp-pill ${presence.tone}`}>
          <i aria-hidden="true" />
          {presence.text}
        </span>
      )}
      {shift && (
        <span className="emp-pill shift">
          <Icon name="clock" size={13} />
          {shift.replace('–', ' – ')}
        </span>
      )}
      {seen && <span className="emp-seen">{seen}</span>}
    </div>
  )
}

/** A centred dialog (a sheet from the bottom on phones). Escape or the backdrop closes it. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return createPortal(
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
    </div>,
    document.body,
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
  const [f, setF] = useState({ name: '', phone: '', email: '', title: '', start: '', end: '', admin: false })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ name: string; phone: string; password: string } | null>(null)
  const isOwner = ownerRole()?.role === 'owner' || ownerRole()?.role === 'admin'
  const endBeforeStart = !!f.end && f.end <= (f.start || office?.start || '00:00')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await studioPost<{ name: string; phone: string; password: string; email?: string }>('accounts/add', { ...f, email: f.email.trim() || undefined, start: f.start || undefined, end: f.end || undefined })
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
            Email <small>(for sign-in, password reset and task / leave emails)</small>
            <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="e.g. vimal@gmail.com" autoComplete="off" required />
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
            <button className="btn" disabled={busy || endBeforeStart || f.name.trim().length < 2 || f.phone.replace(/\D/g, '').length < 10 || !/^\S+@\S+\.\S+$/.test(f.email.trim())}>
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

const SIGNIN = 'https://realty-more.github.io/rnm-news/#/account'
const inviteMessage = () =>
  `Hi, please make your Realtynmore account so I can give you R&M Newsroom access:\n1. Open ${SIGNIN}\n2. Tap "Create account" (email, mobile number or Google)\n3. Send me the email or number you used.`
const accessMessage = (name: string, how: string) =>
  `Hi ${name.split(' ')[0]}, you now have R&M Newsroom access in the Realtynmore app.\nSign in with your own account (${how}) at ${SIGNIN}\nThe Newsroom opens by itself. Menu → Open Newsroom also works.`
const signInWith = (a: { email: string; phone: string; google: boolean }) => (a.google ? `Google · ${a.email}` : a.email || (a.phone ? showPhone(a.phone) : ''))

/**
 * Give Newsroom access to an account the person made themself: find it by email or mobile, choose
 * Employee or Full access, designation and office hours. Their own login then opens the Newsroom.
 */
export function GrantAccessDialog({ onClose, onDone, office, edit }: { onClose: () => void; onDone: () => void; office?: { start: string; end: string }; edit?: Linked }) {
  const [id, setId] = useState('')
  const [found, setFound] = useState<Found | null>(
    edit ? { readerId: edit.readerId, name: edit.name, email: edit.email, phone: edit.phone, google: edit.google, created: edit.granted, access: edit.role } : null,
  )
  const [miss, setMiss] = useState<{ team?: string } | null>(null)
  // Team logins with the same name: probably the same person, so link instead of a second entry.
  const [same, setSame] = useState<SameName[]>([])
  const [linkTo, setLinkTo] = useState('')
  const [f, setF] = useState({ role: (edit?.role ?? 'editor') as 'admin' | 'editor', title: edit?.title ?? '', start: '', end: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ name: string; how: string; phone: string; linked?: boolean } | null>(null)
  const endBeforeStart = !!f.end && f.end <= (f.start || office?.start || '00:00')
  const digits = id.replace(/\D/g, '')
  const find = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMiss(null)
    setFound(null)
    setSame([])
    setLinkTo('')
    try {
      const r = await studioPost<{ found: boolean; team?: string; account?: Found; sameName?: SameName[] }>('access/find', { id })
      if (r.found && r.account) {
        const acc = r.account
        setFound(acc)
        const matches = (r.sameName ?? []).filter((x) => x.personId !== acc.sameAs)
        setSame(acc.sameAs ? [] : matches)
        setLinkTo(acc.sameAs ? '' : (matches[0]?.personId ?? ''))
        if (acc.access) setF((x) => ({ ...x, role: acc.access ?? x.role }))
      } else setMiss({ team: r.team })
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const grant = async () => {
    if (!found) return
    setBusy(true)
    try {
      const r = await studioPost<{ name: string; role: string; changed: boolean; linked?: boolean }>('access/grant', {
        readerId: found.readerId,
        role: f.role,
        title: f.title,
        start: f.start || undefined,
        end: f.end || undefined,
        ...(linkTo ? { sameAs: linkTo } : {}),
      })
      onDone()
      if (edit) {
        toast(`${r.name}: ${f.role === 'admin' ? 'Full access' : 'Employee access'} saved`)
        onClose()
      } else setDone({ name: r.name, how: signInWith(found), phone: found.phone, linked: !!r.linked })
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (done) {
    const msg = accessMessage(done.name, done.how)
    return (
      <Dialog title="Newsroom access given" onClose={onClose}>
        <div className="login-card">
          <p className="login-card-ok">{done.linked ? `✓ Linked: one person, ${done.name}` : `✓ ${done.name} can now open R&M Newsroom`}</p>
          <dl>
            <dt>{done.linked ? 'Also signs in with' : 'They sign in with'}</dt>
            <dd>{done.how}</dd>
            <dt>Access</dt>
            <dd>{done.linked ? 'Same as their team login' : f.role === 'admin' ? 'Full access' : 'Employee'}</dd>
          </dl>
          <p className="meta">
            {done.linked
              ? 'Both logins open the same Newsroom entry: one row in Team today, one attendance, same tasks. Any check-in made with this account today was merged.'
              : 'No new password: they use their own account. Take access away any time from the ⋯ menu.'}
          </p>
          <div className="action-row">
            {done.phone && (
              <a className="btn small" href={`https://wa.me/91${done.phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer">
                Tell them on WhatsApp
              </a>
            )}
            <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(msg).then(() => toast('Message copied'))}>
              Copy message
            </button>
            <button className="btn ghost small" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </Dialog>
    )
  }
  return (
    <Dialog title={edit ? `Change access · ${edit.name}` : 'Give Newsroom access'} onClose={onClose}>
      {!edit && (
        <>
          <ol className="grant-steps">
            <li>They make a Realtynmore account (Sign in → Create account, or Google).</li>
            <li>Search the email or mobile number they used.</li>
            <li>Choose their access. Their own login now opens the Newsroom.</li>
          </ol>
          <form className="emp-form grant-find" onSubmit={find}>
            <label>
              Their email or mobile number
              <span className="grant-find-row">
                <input value={id} onChange={(e) => setId(e.target.value)} placeholder="name@gmail.com or 98xxxxxxxx" autoFocus autoComplete="off" required />
                <button className="btn" disabled={busy || id.trim().length < 5}>
                  {busy && !found ? 'Finding…' : 'Find'}
                </button>
              </span>
            </label>
          </form>
        </>
      )}
      {miss && (
        <div className="grant-miss" role="status">
          {miss.team ? (
            <p>
              <strong>{miss.team}</strong> already has a team login with this number or email. They can sign in with it; nothing else is needed.
            </p>
          ) : (
            <>
              <p>
                <strong>No account yet</strong> with this email or number. Ask them to create one first, then search again.
              </p>
              <div className="action-row">
                <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(inviteMessage()).then(() => toast('Invite copied'))}>
                  Copy invite message
                </button>
                {!id.includes('@') && digits.length >= 10 && (
                  <a className="btn ghost small" href={`https://wa.me/91${digits.slice(-10)}?text=${encodeURIComponent(inviteMessage())}`} target="_blank" rel="noopener noreferrer">
                    Send invite on WhatsApp
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {found && (
        <div className="grant-pick">
          <div className="grant-who">
            <PersonAvatar name={found.name} size={44} />
            <div>
              <strong>{found.name}</strong>
              <span className="meta">
                {signInWith(found)}
                {found.phone && found.email ? ` · ${showPhone(found.phone)}` : ''}
                {!edit && found.created ? ` · account since ${formatDateTime(found.created)}` : ''}
              </span>
            </div>
            {found.access && <span className="acct-tag">{found.access === 'admin' ? 'Full access' : 'Employee'}</span>}
          </div>
          {same.length > 0 && (
            <div className="grant-same" role="radiogroup" aria-label="Same person?">
              <p>
                <b>Same person?</b> {same.length === 1 ? `${same[0].name} already has a team login (${showPhone(same[0].phone)}).` : 'These team logins have the same name.'} Linking keeps one person in Team today and
                attendance.
              </p>
              {same.map((x) => (
                <label key={x.personId} className={`grant-same-opt ${linkTo === x.personId ? 'on' : ''}`}>
                  <input type="radio" name="same" checked={linkTo === x.personId} onChange={() => setLinkTo(x.personId)} />
                  <span>
                    <b>Yes, link to {x.name}’s login</b>
                    <small>{showPhone(x.phone)} · keeps that login’s access, history and office time</small>
                  </span>
                </label>
              ))}
              <label className={`grant-same-opt ${!linkTo ? 'on' : ''}`}>
                <input type="radio" name="same" checked={!linkTo} onChange={() => setLinkTo('')} />
                <span>
                  <b>No, a different person</b>
                  <small>Give this account its own Newsroom access</small>
                </span>
              </label>
            </div>
          )}
          {!linkTo && (
          <div className="grant-roles" role="radiogroup" aria-label="Access">
            {(
              [
                ['editor', 'Employee', 'My day, check-in, daily report, tasks and the content tools.'],
                ['admin', 'Full access', 'Everything you see: business numbers, ad sales, media kit, team and settings.'],
              ] as const
            ).map(([v, label, text]) => (
              <button key={v} type="button" role="radio" aria-checked={f.role === v} className={`grant-role ${f.role === v ? 'on' : ''}`} onClick={() => setF({ ...f, role: v })}>
                <strong>{label}</strong>
                <small>{text}</small>
              </button>
            ))}
          </div>
          )}
          {!linkTo && (
          <div className="emp-form">
            <label>
              Designation <small>(optional)</small>
              <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Video Editor" maxLength={60} />
            </label>
            {!edit && (
              <>
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
                  {endBeforeStart ? 'End time is before start time. For 6 in the evening choose 6:00 PM (18:00).' : `Leave empty to use the office time${office ? ` (${office.start}–${office.end})` : ''}.`}
                </p>
              </>
            )}
          </div>
          )}
          <div className="action-row">
            <button className="btn" disabled={busy || endBeforeStart} onClick={() => void grant()}>
              {busy ? 'Saving…' : linkTo ? `Link to ${same.find((x) => x.personId === linkTo)?.name.split(' ')[0] ?? 'team'}’s login` : edit ? 'Save access' : found.access ? 'Update access' : 'Give Newsroom access'}
            </button>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

interface AccessKey {
  id: string
  name: string
  created: string
  lastUsed?: string
  kind?: 'access'
}

/** A text file with the key and how to use it (for the handover folder). */
function saveKeyFile(name: string, key: string) {
  const made = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
  const text = [
    'R&M NEWSROOM - FULL ACCESS KEY',
    '',
    `Name: ${name}`,
    `Made: ${made} (IST)`,
    '',
    `Key: ${key}`,
    '',
    'How to sign in:',
    '1. Open https://realty-more.github.io/rnm-news/#/account (or the Realtynmore app → Menu → Sign in)',
    '2. Tap "Team login key"',
    '3. Paste the key and tap "Open Newsroom"',
    '',
    'This key opens every Newsroom section (Full access). Keep this file private.',
    'If it is lost or shared by mistake: R&M Newsroom → Manage → Employees → Access keys → Revoke.',
    '',
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `RNM Newsroom - ${name.replace(/[\\/:*?"<>|]/g, '')}.txt`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * Full access keys (owner and full access): a spare way into R&M Newsroom with every section, e.g. for a
 * handover folder. Shown once, with "Save as file"; Revoke stops a key at once on every device.
 */
export function AccessKeys() {
  const res = useAsync('studio:team', (s) => studio<{ editors: AccessKey[] }>('team', undefined, s))
  const [label, setLabel] = useState('')
  const [made, setMade] = useState<{ name: string; key: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<AccessKey | null>(null)
  const keys = (res.data?.editors ?? []).filter((e) => e.kind === 'access')
  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await studioPost<{ key: string; editor: AccessKey }>('team', { name: label.trim() || 'Full access key', kind: 'access' })
      setMade({ name: r.editor.name, key: r.key })
      setLabel('')
      res.reload()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (k: AccessKey) => {
    setBusy(true)
    try {
      await studioPost('team/revoke', { id: k.id })
      toast(`“${k.name}” no longer works`)
      res.reload()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }
  return (
    <section className="akeys">
      <div>
        <h3>Access keys</h3>
        <p className="meta">A Full access key opens R&amp;M Newsroom with every section. Sign in page → Team login key. Keep it private; revoke it any time.</p>
      </div>
      {made && (
        <div className="akeys-new" role="status">
          <strong>{made.name}</strong>
          <code>{made.key}</code>
          <p className="meta">Shown only once. Save it as a file (for the handover folder) or copy it now.</p>
          <div className="action-row">
            <button className="btn small" onClick={() => saveKeyFile(made.name, made.key)}>
              Save as file
            </button>
            <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(made.key).then(() => toast('Key copied'))}>
              Copy key
            </button>
            <button className="btn ghost small" onClick={() => setMade(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      {keys.length > 0 && (
        <ul className="akeys-list">
          {keys.map((k) => (
            <li key={k.id}>
              <span aria-hidden="true">🔑</span>
              <span className="akeys-text">
                <b>
                  {k.name} <span className="acct-tag">Full access</span>
                </b>
                <small>
                  Made {formatDateTime(k.created)} · {k.lastUsed ? `last used ${seenLabel(k.lastUsed).toLowerCase()}` : 'not used yet'}
                </small>
              </span>
              <button className="btn ghost small danger-text" disabled={busy} onClick={() => setConfirm(k)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="akeys-form" onSubmit={create}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Key name, e.g. Handover key" maxLength={40} aria-label="Key name" />
        <button className="btn" disabled={busy}>
          {busy ? 'Making…' : '+ Make Full access key'}
        </button>
      </form>
      {confirm && (
        <Dialog title={`Revoke “${confirm.name}”?`} onClose={() => setConfirm(null)}>
          <p>The key stops working at once, on every device that used it.</p>
          <div className="action-row">
            <button className="btn danger" disabled={busy} onClick={() => void revoke(confirm)}>
              {busy ? 'Working…' : 'Revoke key'}
            </button>
            <button className="btn ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}

/**
 * The "⋯" menu on a row. On phones it opens as a sheet from the bottom with the row's name on top
 * (so it never looks like part of the section below); on larger screens as a small dropdown that
 * opens upwards when there is no room below.
 */
export function RowMenu({ items, title }: { items: { label: string; danger?: boolean; onClick: () => void }[]; title?: string }) {
  const [open, setOpen] = useState<false | 'down' | 'up' | 'sheet'>(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => open !== 'sheet' && !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const toggle = () => {
    if (open) return setOpen(false)
    if (window.matchMedia('(max-width: 640px)').matches) return setOpen('sheet')
    const r = ref.current?.getBoundingClientRect()
    const need = items.length * 42 + 24
    setOpen(r && window.innerHeight - r.bottom < need && r.top > need ? 'up' : 'down')
  }
  const pick = (fn: () => void) => {
    setOpen(false)
    fn()
  }
  const buttons = items.map((i) => (
    <button key={i.label} role="menuitem" className={i.danger ? 'danger' : ''} onClick={() => pick(i.onClick)}>
      {i.label}
    </button>
  ))
  return (
    <div className="row-menu" ref={ref}>
      <button className="icon-btn" onClick={toggle} aria-haspopup="menu" aria-expanded={!!open} aria-label={title ? `More actions for ${title}` : 'More actions'}>
        ⋯
      </button>
      {(open === 'down' || open === 'up') && (
        <div className={`row-menu-list ${open === 'up' ? 'up' : ''}`} role="menu">
          {buttons}
        </div>
      )}
      {open === 'sheet' &&
        createPortal(
          <div className="sheet-scrim" onClick={() => setOpen(false)}>
            <div className="sheet" role="menu" aria-label={title ?? 'Actions'} onClick={(e) => e.stopPropagation()}>
              <span className="sheet-grip" aria-hidden="true" />
              {title && <div className="sheet-title">{title}</div>}
              <div className="sheet-items">{buttons}</div>
              <button className="sheet-cancel" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

export function EmployeesTab() {
  const res = useAsync('studio:accounts', (s) => studio<{ accounts: Account[]; linked?: Linked[] }>('accounts', undefined, s))
  const settings = useAsync('studio:team-settings', (s) => studio<{ settings: Settings }>('team/settings', undefined, s))
  const [adding, setAdding] = useState(false)
  const [granting, setGranting] = useState<Linked | true | null>(null)
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: string; danger?: boolean; run: () => Promise<void> } | null>(null)
  const [newPw, setNewPw] = useState<{ name: string; phone: string; password: string } | null>(null)
  const [emailFor, setEmailFor] = useState<Account | null>(null)
  const [emailVal, setEmailVal] = useState('')
  const [busy, setBusy] = useState(false)
  const me = ownerRole()
  const s = settings.data?.settings

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (res.data?.accounts ?? []).filter((a) => a.role !== 'owner' && a.status !== 'pending' && (!t || a.name.toLowerCase().includes(t) || a.phone.includes(t) || a.title?.toLowerCase().includes(t)))
  }, [res.data, q])
  const linked = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (res.data?.linked ?? []).filter((a) => !a.sameAs && (!t || a.name.toLowerCase().includes(t) || a.phone.includes(t) || a.email.includes(t) || a.title?.toLowerCase().includes(t)))
  }, [res.data, q])
  // Own accounts that sign in as a team login (same person), shown on that login's row.
  const alsoBy = useMemo(() => {
    const m = new Map<string, Linked[]>()
    // The app account made automatically at team sign-in (same number) is not worth showing.
    for (const l of res.data?.linked ?? []) if (l.sameAs && l.sameAs !== `ph:${l.phone}`) m.set(l.sameAs, [...(m.get(l.sameAs) ?? []), l])
    return m
  }, [res.data])
  const pending = (res.data?.accounts ?? []).filter((a) => a.status === 'pending')
  const actLinked = (a: Linked, action: 'revoke' | 'signout') =>
    run(async () => {
      await studioPost(`access/${action}`, { readerId: a.readerId })
      toast(action === 'revoke' ? `${a.name} can no longer open the Newsroom` : `${a.name} is logged out everywhere`)
      res.reload()
    })

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
  const shift = (a: Account | Linked) => {
    if (!s) return ''
    const p = s.people?.['personId' in a ? a.personId : `ph:${a.phone}`]
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
            {list.filter((a) => a.status === 'active').length + linked.length} active ·{' '}
            {list.filter((a) => a.devices && seenLabel(a.lastSeen) === 'Online now').length + linked.filter((a) => seenLabel(a.lastSeen) === 'Online now').length} online now ·{' '}
            {list.filter((a) => a.devices).length + linked.length} signed in
          </p>
        </div>
        <div className="emp-head-btns">
          <button className="btn" onClick={() => setGranting(true)}>
            Give Newsroom access
          </button>
          <button className="btn ghost" onClick={() => setAdding(true)} title="Mobile number login with a temporary password">
            + Add employee
          </button>
        </div>
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

      {list.length + linked.length === 0 ? (
        <p className="empty">{res.data.accounts.length || res.data.linked?.length ? 'Nobody matches.' : 'No employees yet. Tap “Give Newsroom access”.'}</p>
      ) : (
        <div className="emp-list">
          {linked.map((a) => (
            <div key={a.personId} className="emp-row">
              <PersonAvatar name={a.name} photo={a.photo} avatar={a.avatar} size={44} />
              <div className="emp-main">
                <strong>
                  {a.name} {a.role === 'admin' && <span className="acct-tag">Full access</span>}
                </strong>
                <span className="meta">{[a.title, signInWith(a)].filter(Boolean).join(' · ')}</span>
              </div>
              <EmpFacts
                presence={seenLabel(a.lastSeen) === 'Online now' ? { tone: 'online', text: 'Online now' } : { tone: 'in', text: 'Own account' }}
                shift={shift(a)}
                seen={seenLabel(a.lastSeen) === 'Online now' ? '' : a.lastSeen ? `Last seen ${seenLabel(a.lastSeen).toLowerCase().replace(/^today/, 'today')}` : 'Not signed in yet'}
              />
              <RowMenu
                title={a.name}
                items={[
                  a.role === 'admin'
                    ? { label: 'Change to Employee access', onClick: () => setGranting({ ...a, role: 'editor' }) }
                    : { label: 'Give full access', onClick: () => setGranting({ ...a, role: 'admin' }) },
                  { label: 'Change designation', onClick: () => setGranting(a) },
                  {
                    label: 'Log out from all devices',
                    onClick: () =>
                      setConfirm({
                        title: `Log ${a.name} out everywhere?`,
                        text: 'They will need to sign in again with their own account. Use this if a phone is lost.',
                        action: 'Log out everywhere',
                        run: () => actLinked(a, 'signout'),
                      }),
                  },
                  {
                    label: 'Remove Newsroom access',
                    danger: true,
                    onClick: () =>
                      setConfirm({
                        title: `Remove ${a.name}’s Newsroom access?`,
                        text: 'The Newsroom closes for them at once. Their Realtynmore account stays as a normal reader account. Past attendance, reports and leave stay in the records.',
                        action: 'Remove access',
                        danger: true,
                        run: () => actLinked(a, 'revoke'),
                      }),
                  },
                ]}
              />
            </div>
          ))}
          {list.map((a) => (
            <div key={a.phone} className={`emp-row ${a.status === 'rejected' ? 'off' : ''}`}>
              <PersonAvatar name={a.name} photo={a.photo} avatar={a.avatar} size={44} />
              <div className="emp-main">
                <strong>
                  {a.name} {a.role === 'admin' && <span className="acct-tag">Full access</span>}
                </strong>
                <span className="meta">
                  {[a.title, showPhone(a.phone), a.email, ...(alsoBy.get(`ph:${a.phone}`) ?? []).map((l) => `also ${signInWith(l)}`)].filter(Boolean).join(' · ')}
                </span>
              </div>
              <EmpFacts
                status={a.status === 'rejected' ? 'declined' : a.mustChange ? 'pending' : 'active'}
                presence={
                  seenLabel(a.lastSeen ?? a.lastLogin) === 'Online now' && a.devices
                    ? { tone: 'online', text: 'Online now' }
                    : a.devices
                      ? { tone: 'in', text: a.devices > 1 ? `Signed in on ${a.devices} devices` : 'Signed in' }
                      : { tone: 'out', text: 'Signed out' }
                }
                shift={shift(a)}
                seen={
                  seenLabel(a.lastSeen ?? a.lastLogin) === 'Online now' && a.devices
                    ? ''
                    : a.lastSeen || a.lastLogin
                      ? `Last seen ${seenLabel(a.lastSeen ?? a.lastLogin).toLowerCase()}`
                      : 'Never signed in'
                }
              />
              <RowMenu
                title={a.name}
                items={[
                  {
                    label: a.email ? 'Change email' : 'Add email',
                    onClick: () => {
                      setEmailVal(a.email ?? '')
                      setEmailFor(a)
                    },
                  },
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
                  ...(alsoBy.get(`ph:${a.phone}`) ?? []).map((l) => ({
                    label: `Stop sign-in with ${l.email || (l.phone ? showPhone(l.phone) : 'own account')}`,
                    onClick: () =>
                      setConfirm({
                        title: 'Stop this sign-in?',
                        text: `${a.name} will no longer open the Newsroom with ${signInWith(l)}. Their mobile login keeps working.`,
                        action: 'Stop sign-in',
                        run: () => actLinked(l, 'revoke'),
                      }),
                  })),
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

      {(me?.role === 'owner' || me?.role === 'admin') && <AccessKeys />}
      {granting && (
        <GrantAccessDialog onClose={() => setGranting(null)} onDone={res.reload} office={s ? { start: s.startTime, end: s.endTime } : undefined} edit={granting === true ? undefined : granting} />
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
      {emailFor && (
        <Dialog title={`${emailFor.email ? 'Change' : 'Add'} email · ${emailFor.name}`} onClose={() => setEmailFor(null)}>
          <form
            className="emp-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                const r = await studioPost<{ email: string }>('accounts/email', { phone: emailFor.phone, email: emailVal })
                toast(r.email ? `${emailFor.name.split(' ')[0]} can now sign in with ${r.email} and get reset codes there` : 'Email removed')
                setEmailFor(null)
                res.reload()
              })
            }}
          >
            <label>
              Email
              <input type="email" value={emailVal} onChange={(e) => setEmailVal(e.target.value)} placeholder="name@gmail.com" autoFocus />
            </label>
            <p className="meta">They can sign in with it, get “Forgot password?” codes and task / leave emails.</p>
            <div className="action-row">
              <button className="btn" disabled={busy || (!emailVal.trim() && !emailFor.email)}>
                {busy ? 'Saving…' : emailVal.trim() ? 'Save email' : 'Remove email'}
              </button>
              <button type="button" className="btn ghost" onClick={() => setEmailFor(null)}>
                Cancel
              </button>
            </div>
          </form>
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
