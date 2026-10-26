// Studio sign-in: mobile number + password (no OTP), "Create account", and the older login key.
// Staff accounts need the owner's approval; the owner manages them under Manage > Team & keys.
import { useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDateTime } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { createAccount, ownerRole, passwordLogin, studio, studioPost, unlock } from '../lib/owner.ts'
import { Panel } from './StudioTools.tsx'

type Mode = 'login' | 'signup' | 'key'

function PasswordInput({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="pw-field">
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoComplete={autoComplete} maxLength={64} />
      <button type="button" className="pw-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

function PhoneInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="phone-field">
      <span>+91</span>
      <input inputMode="numeric" autoComplete="tel-national" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, '').slice(0, 12))} placeholder="Mobile number" aria-label="Mobile number" />
    </div>
  )
}

/** Log in, Create account, or Use a login key. */
export function AuthScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isOwner, setIsOwner] = useState(false)
  const [setupKey, setSetupKey] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  const welcome = () => {
    toast(`Welcome, ${ownerRole()?.name ?? 'back'}`)
    onDone()
  }
  const run = async (e: FormEvent, job: () => Promise<void>) => {
    e.preventDefault()
    setBusy(true)
    try {
      await job()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const doLogin = (e: FormEvent) =>
    run(e, async () => {
      await passwordLogin(phone, password)
      welcome()
    })
  const doSignup = (e: FormEvent) =>
    run(e, async () => {
      if (password !== confirm) throw new Error('The two passwords don’t match.')
      const r = await createAccount({ name, phone, password, ownerKey: isOwner ? setupKey : undefined })
      if (r.pending) {
        setSent(r.name)
        setPassword('')
        setConfirm('')
      } else welcome()
    })
  const doKey = (e: FormEvent) =>
    run(e, async () => {
      if (!(await unlock(key))) throw new Error('That login key is not right')
      welcome()
    })

  return (
    <div className="page studio-lock">
      <div className="lock-card auth-card">
        <Icon name="settings" size={28} />
        <h1>{mode === 'signup' ? 'Create account' : 'Login'}</h1>
        <p>For the owner, Palash Roy (Founder &amp; Editor), and the RealtyNMore team. You stay logged in on this device until you log out.</p>

        {mode !== 'key' && (
          <div className="segmented wide" role="tablist" aria-label="Login or create account">
            <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => (setMode('login'), setSent(null))}>
              Log in
            </button>
            <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>
              Create account
            </button>
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={doLogin} className="auth-form">
            <PhoneInput value={phone} onChange={setPhone} />
            <PasswordInput value={password} onChange={setPassword} placeholder="Password" autoComplete="current-password" />
            <button className="btn" disabled={busy || phone.replace(/\D/g, '').length < 10 || !password}>
              {busy ? 'Checking…' : 'Log in'}
            </button>
            <p className="auth-note">Forgot your password? Ask Palash sir to set a new one from the Studio.</p>
          </form>
        )}

        {mode === 'signup' &&
          (sent ? (
            <div className="auth-sent">
              <strong>Request sent, {sent}.</strong>
              <p>Palash sir will approve your account. After that, log in with your mobile number and password.</p>
              <button className="btn" onClick={() => (setMode('login'), setSent(null))}>
                Go to log in
              </button>
            </div>
          ) : (
            <form onSubmit={doSignup} className="auth-form">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" aria-label="Full name" autoComplete="name" maxLength={40} />
              <PhoneInput value={phone} onChange={setPhone} />
              <PasswordInput value={password} onChange={setPassword} placeholder="Password (8+ letters and numbers)" autoComplete="new-password" />
              <PasswordInput value={confirm} onChange={setConfirm} placeholder="Confirm password" autoComplete="new-password" />
              <label className="auth-check">
                <input type="checkbox" checked={isOwner} onChange={(e) => setIsOwner(e.target.checked)} /> I am the owner (Palash Roy)
              </label>
              {isOwner && <PasswordInput value={setupKey} onChange={setSetupKey} placeholder="Owner setup key" autoComplete="off" />}
              <button className="btn" disabled={busy || name.trim().length < 2 || phone.replace(/\D/g, '').length < 10 || password.length < 8 || !confirm || (isOwner && !setupKey)}>
                {busy ? 'Creating…' : isOwner ? 'Create owner account' : 'Send request'}
              </button>
              <p className="auth-note">{isOwner ? 'The owner setup key is the owner key you already have. Your account works straight away.' : 'Team accounts start working after Palash sir approves them.'}</p>
            </form>
          ))}

        {mode === 'key' && (
          <form onSubmit={doKey} className="auth-form">
            <PasswordInput value={key} onChange={setKey} placeholder="Login key" autoComplete="off" />
            <button className="btn" disabled={busy || key.trim().length < 8}>
              {busy ? 'Checking…' : 'Log in with key'}
            </button>
          </form>
        )}

        <button className="auth-switch" onClick={() => setMode(mode === 'key' ? 'login' : 'key')}>
          {mode === 'key' ? 'Log in with mobile number instead' : 'Have a login key? Use it instead'}
        </button>
      </div>
    </div>
  )
}

interface Account { phone: string; name: string; role: 'owner' | 'admin' | 'editor'; status: 'pending' | 'active' | 'rejected'; created: string; approved: string | null; lastLogin: string | null }

const showPhone = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`

/** Owner: account requests and team accounts (approve, reset password, remove). */
export function AccountsPanel() {
  const res = useAsync('studio:accounts', (s) => studio<{ accounts: Account[] }>('accounts', undefined, s))
  const [busy, setBusy] = useState<string | null>(null)
  const [newPw, setNewPw] = useState<{ name: string; password: string } | null>(null)
  const iAmOwner = ownerRole()?.role === 'owner'
  const act = async (a: Account, action: 'approve' | 'reject' | 'remove' | 'reset' | 'grant' | 'ungrant') => {
    const ask = {
      reject: `Turn down ${a.name}'s request?`,
      remove: `Remove ${a.name}'s account? They will be logged out.`,
      reset: `Set a new password for ${a.name}? They will be logged out everywhere.`,
      grant: `Give ${a.name} full access? They will see everything you see: business numbers, traffic, team, attendance and settings.`,
      approve: '',
      ungrant: '',
    }[action]
    if (ask && !window.confirm(ask)) return
    setBusy(a.phone + action)
    try {
      const r = await studioPost<{ password?: string }>(`accounts/${action}`, { phone: a.phone })
      if (r.password) setNewPw({ name: a.name, password: r.password })
      else toast(action === 'approve' ? `${a.name} can now log in` : action === 'grant' ? `${a.name} now has full access` : 'Done')
      res.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data) return <SkeletonList count={2} />
  const pending = res.data.accounts.filter((a) => a.status === 'pending')
  const others = res.data.accounts.filter((a) => a.status !== 'pending')
  return (
    <>
      {newPw && (
        <div className="new-key auth-newpw" role="status">
          <strong>New password for {newPw.name}</strong>
          <code>{newPw.password}</code>
          <p>Send it to them on WhatsApp; they can change it after logging in. It is shown only once.</p>
          <div className="action-row">
            <button className="btn small" onClick={() => void navigator.clipboard?.writeText(newPw.password).then(() => toast('Copied'))}>
              Copy
            </button>
            <button className="btn ghost small" onClick={() => setNewPw(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      <Panel title={`Account requests${pending.length ? ` (${pending.length})` : ''}`} note="People who tapped “Create account” on the login screen. Approve only your own staff.">
        {pending.length === 0 ? (
          <p className="panel-note">No requests waiting.</p>
        ) : (
          <ul className="acct-list">
            {pending.map((a) => (
              <li key={a.phone}>
                <div>
                  <strong>{a.name}</strong>
                  <small>
                    {showPhone(a.phone)} · asked {formatDateTime(a.created)}
                  </small>
                </div>
                <div className="acct-btns">
                  <button className="btn small" disabled={!!busy} onClick={() => act(a, 'approve')}>
                    Approve
                  </button>
                  <button className="btn ghost small" disabled={!!busy} onClick={() => act(a, 'reject')}>
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Accounts" note="Log in with mobile number and password. Forgot password: tap “New password” and send it to them.">
        {others.length === 0 ? (
          <p className="panel-note">No accounts yet. Ask your team to tap “Create account” on the login screen.</p>
        ) : (
          <ul className="acct-list">
            {others.map((a) => (
              <li key={a.phone} className={a.status === 'rejected' ? 'off' : ''}>
                <div>
                  <strong>
                    {a.name} {a.role === 'owner' && <span className="acct-tag">Owner</span>}
                    {a.role === 'admin' && <span className="acct-tag">Full access</span>}
                    {a.status === 'rejected' && <span className="acct-tag off">Declined</span>}
                  </strong>
                  <small>
                    {showPhone(a.phone)} · {a.lastLogin ? `last login ${formatDateTime(a.lastLogin)}` : 'not logged in yet'}
                  </small>
                </div>
                <div className="acct-btns">
                  {a.status === 'active' && (a.role !== 'owner' || ownerRole()?.role === 'owner') && (
                    <button className="btn ghost small" disabled={!!busy} onClick={() => act(a, 'reset')}>
                      New password
                    </button>
                  )}
                  {iAmOwner && a.status === 'active' && a.role !== 'owner' && (
                    <button className="btn ghost small" disabled={!!busy} onClick={() => act(a, a.role === 'admin' ? 'ungrant' : 'grant')}>
                      {a.role === 'admin' ? 'Team access' : 'Full access'}
                    </button>
                  )}
                  {a.role !== 'owner' && (iAmOwner || a.role !== 'admin') && (
                    <button className="btn ghost small" disabled={!!busy} onClick={() => act(a, 'remove')} aria-label={`Remove ${a.name}`}>
                      <Icon name="trash" size={15} />
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

/** Signed-in account changes its own password. */
export function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) return toast('The two new passwords don’t match.')
    setBusy(true)
    try {
      await studioPost('me/password', { current, next })
      toast('Password changed. Other devices are logged out.')
      onClose()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title="Change password">
      <form onSubmit={submit} className="auth-form">
        <PasswordInput value={current} onChange={setCurrent} placeholder="Current password" autoComplete="current-password" />
        <PasswordInput value={next} onChange={setNext} placeholder="New password (8+ letters and numbers)" autoComplete="new-password" />
        <PasswordInput value={confirm} onChange={setConfirm} placeholder="Confirm new password" autoComplete="new-password" />
        <div className="action-row">
          <button className="btn" disabled={busy || !current || next.length < 8 || !confirm}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  )
}
