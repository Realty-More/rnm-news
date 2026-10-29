// "My account" for readers: sign in or create an account (email and password), reset a forgotten
// password with an emailed code, and, once signed in, see the profile, sync status and saved
// stories, change the password, log out or delete the account. Team members use the separate
// "Team login" (R&M Newsroom); readers never see the Newsroom.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { toast } from '../components/Toast.tsx'
import { usePageTitle } from './usePageTitle.ts'
import { usePrefs } from '../lib/prefs.ts'
import { readerChangePassword, readerDeleteAccount, readerForgot, readerRename, readerReset, readerSignIn, readerSignOut, readerSignUp, syncNow, useReader } from '../lib/reader.ts'
import { timeAgo } from '../lib/format.ts'

type Mode = 'signin' | 'signup' | 'forgot' | 'reset'

function Field({ label, type = 'text', value, onChange, autoComplete, placeholder, hint }: { label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string; placeholder?: string; hint?: string }) {
  const [show, setShow] = useState(false)
  const pw = type === 'password'
  return (
    <label className="acct-field">
      <span>{label}</span>
      <span className="acct-input">
        <input type={pw && show ? 'text' : type} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} required />
        {pw && (
          <button type="button" className="acct-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? 'Hide' : 'Show'}
          </button>
        )}
      </span>
      {hint && <small>{hint}</small>}
    </label>
  )
}

function SignedOut() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [f, setF] = useState({ name: '', email: '', password: '', code: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const go = (m: Mode) => {
    setMode(m)
    setError('')
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'signin') await readerSignIn(f.email, f.password)
      else if (mode === 'signup') await readerSignUp(f.name, f.email, f.password)
      else if (mode === 'forgot') {
        await readerForgot(f.email)
        toast('If this email has an account, a 6-digit code is on its way.')
        setMode('reset')
        setBusy(false)
        return
      } else await readerReset(f.email, f.code, f.password)
      toast(mode === 'signup' ? 'Welcome to Realty & More' : 'Signed in')
      navigate('/account', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const title = mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Enter the code'
  return (
    <div className="acct-out">
      <section className="acct-intro">
        <span className="acct-kicker">Realty &amp; More account</span>
        <h1>Your news, on every device</h1>
        <p>Sign in to keep your saved stories, sections and cities the same on your phone and computer.</p>
        <ul className="acct-perks">
          <li>
            <span>
              <Icon name="bookmark" size={18} />
            </span>
            <div>
              <b>Saved stories everywhere</b>
              <small>Save on your phone, read later on your laptop.</small>
            </div>
          </li>
          <li>
            <span>
              <Icon name="sparkle" size={18} />
            </span>
            <div>
              <b>Your feed, your cities</b>
              <small>The sections and cities you follow come with you.</small>
            </div>
          </li>
          <li>
            <span>
              <Icon name="bell" size={18} />
            </span>
            <div>
              <b>Alerts your way</b>
              <small>Your alert choice and language stay set.</small>
            </div>
          </li>
        </ul>
      </section>

      <section className="acct-card" aria-label={title}>
        {(mode === 'signin' || mode === 'signup') && (
          <div className="acct-tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => go('signin')}>
              Sign in
            </button>
            <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => go('signup')}>
              Create account
            </button>
          </div>
        )}
        <h2>{title}</h2>
        {mode === 'reset' && <p className="acct-note">We sent a 6-digit code to {f.email}. It works for 20 minutes. Check Spam if you don’t see it.</p>}
        {mode === 'forgot' && <p className="acct-note">Enter the email you signed up with. We’ll send a code to set a new password.</p>}
        <form className="acct-form" onSubmit={(e) => void submit(e)}>
          {mode === 'signup' && <Field label="Your name" value={f.name} onChange={set('name')} autoComplete="name" placeholder="e.g. Ananya Sharma" />}
          {mode !== 'reset' && <Field label="Email" type="email" value={f.email} onChange={set('email')} autoComplete="email" placeholder="you@example.com" />}
          {mode === 'reset' && <Field label="6-digit code" value={f.code} onChange={(v) => set('code')(v.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" placeholder="000000" />}
          {mode !== 'forgot' && (
            <Field
              label={mode === 'reset' ? 'New password' : 'Password'}
              type="password"
              value={f.password}
              onChange={set('password')}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              hint={mode === 'signin' ? undefined : 'At least 8 characters, with letters and numbers.'}
            />
          )}
          {error && (
            <p className="acct-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn acct-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send code' : 'Set new password'}
          </button>
        </form>
        <div className="acct-links">
          {mode === 'signin' && (
            <button className="acct-link" onClick={() => go('forgot')}>
              Forgot password?
            </button>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <button className="acct-link" onClick={() => go('signin')}>
              ← Back to sign in
            </button>
          )}
          {mode === 'reset' && (
            <button className="acct-link" onClick={() => go('forgot')}>
              Send a new code
            </button>
          )}
        </div>
        <p className="acct-fine">
          By continuing you agree to our{' '}
          <a href="./privacy.html" target="_blank" rel="noopener noreferrer">
            privacy policy
          </a>
          . We never share your email.
        </p>
      </section>

      <p className="acct-team">
        Realty &amp; More team? <Link to="/studio">Team login</Link>
      </p>
    </div>
  )
}

function SignedIn() {
  const s = useReader()!
  const [prefs] = usePrefs()
  const navigate = useNavigate()
  const [syncing, setSyncing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(s.me.name)
  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState({ old: '', next: '' })
  const [delOpen, setDelOpen] = useState(false)
  const [delPw, setDelPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])
  const initials = s.me.name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const since = new Date(s.me.created).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const doSync = async () => {
    setSyncing(true)
    try {
      await syncNow()
      toast('Everything is up to date')
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setSyncing(false)
    }
  }
  const run = async (fn: () => Promise<void>, ok: string, after?: () => void) => {
    setBusy(true)
    try {
      await fn()
      toast(ok)
      after?.()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="acct-in">
      <section className="acct-hero">
        <div className="acct-avatar" aria-hidden="true">
          {initials || '?'}
        </div>
        <div className="acct-who">
          {editing ? (
            <form
              className="acct-rename"
              onSubmit={(e) => {
                e.preventDefault()
                void run(() => readerRename(name), 'Name saved', () => setEditing(false))
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoFocus aria-label="Your name" />
              <button className="btn small" disabled={busy}>
                Save
              </button>
              <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <h1>
              {s.me.name}{' '}
              <button className="acct-edit" onClick={() => setEditing(true)} aria-label="Change name">
                Edit
              </button>
            </h1>
          )}
          <p>{s.me.email}</p>
          <small>Member since {since}</small>
        </div>
      </section>

      <section className="acct-sync">
        <span className={`acct-sync-dot ${syncing ? 'busy' : ''}`} aria-hidden="true" />
        <div>
          <b>{syncing ? 'Syncing…' : s.syncedAt ? 'Synced' : 'Not synced yet'}</b>
          <small>{s.syncedAt ? `Last synced ${timeAgo(s.syncedAt)}. Saved stories and your feed stay the same on every device.` : 'Your saved stories and feed will sync in a moment.'}</small>
        </div>
        <button className="btn ghost small" onClick={() => void doSync()} disabled={syncing}>
          <Icon name="refresh" size={14} /> Sync now
        </button>
      </section>

      <div className="acct-stats">
        <Link to="/saved" className="acct-stat">
          <Icon name="bookmark" size={18} />
          <b>{s.savedCount ?? 0}</b>
          <span>Saved stories</span>
        </Link>
        <Link to="/settings" className="acct-stat">
          <Icon name="grid" size={18} />
          <b>{prefs.topics.length}</b>
          <span>Sections followed</span>
        </Link>
        <Link to="/settings" className="acct-stat">
          <Icon name="news" size={18} />
          <b>{prefs.cities.length}</b>
          <span>Cities followed</span>
        </Link>
      </div>

      <section className="acct-list">
        <h2>Account</h2>
        <Link to="/settings" className="acct-row">
          <Icon name="settings" size={18} />
          <span>
            My feed, alerts and language
            <small>Changes here sync to your other devices</small>
          </span>
          <Icon name="chevron" size={16} />
        </Link>
        <button className="acct-row" onClick={() => setPwOpen((o) => !o)} aria-expanded={pwOpen}>
          <Icon name="settings" size={18} />
          <span>
            Change password
            <small>Use at least 8 characters, letters and numbers</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        {pwOpen && (
          <form
            className="acct-form acct-inline"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => readerChangePassword(pw.old, pw.next), 'Password changed', () => {
                setPwOpen(false)
                setPw({ old: '', next: '' })
              })
            }}
          >
            <Field label="Current password" type="password" value={pw.old} onChange={(v) => setPw((x) => ({ ...x, old: v }))} autoComplete="current-password" />
            <Field label="New password" type="password" value={pw.next} onChange={(v) => setPw((x) => ({ ...x, next: v }))} autoComplete="new-password" />
            <button className="btn small" disabled={busy}>
              Change password
            </button>
          </form>
        )}
        <button
          className="acct-row"
          onClick={() => {
            if (!window.confirm('Log out of your Realty & More account on this device? Your saved stories stay on this device.')) return
            void readerSignOut().then(() => {
              toast('Logged out')
              navigate('/account', { replace: true })
            })
          }}
        >
          <Icon name="back" size={18} />
          <span>
            Log out
            <small>Only on this device</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <button className="acct-row danger" onClick={() => setDelOpen((o) => !o)} aria-expanded={delOpen}>
          <Icon name="trash" size={18} />
          <span>
            Delete account
            <small>Removes your account and synced data for good</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        {delOpen && (
          <form
            className="acct-form acct-inline"
            onSubmit={(e) => {
              e.preventDefault()
              if (!window.confirm('Delete your account for good? This cannot be undone.')) return
              void run(() => readerDeleteAccount(delPw), 'Account deleted', () => navigate('/account', { replace: true }))
            }}
          >
            <p className="acct-note">Your name, email and synced list will be deleted. Stories saved on this device stay here.</p>
            <Field label="Password" type="password" value={delPw} onChange={setDelPw} autoComplete="current-password" />
            <button className="btn danger small" disabled={busy}>
              Delete my account
            </button>
          </form>
        )}
      </section>
    </div>
  )
}

export default function Account() {
  const s = useReader()
  usePageTitle(s ? 'My account' : 'Sign in')
  return <div className="page acct-page">{s ? <SignedIn /> : <SignedOut />}</div>
}
