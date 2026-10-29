// "My account": one sign-in for everyone.
//   Email or mobile number + password. A mobile number that belongs to a Realty & More team login
//   opens R&M Newsroom with the team password, exactly as before (no new account needed). Anything
//   else is a reader account. "Continue with Google" for readers when the Google client is set up.
//   Signed in (reader): profile, sync status and counts, add an email or mobile number, set or change
//   the password, log out, delete the account. Readers never see R&M Newsroom.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Icon } from '../components/Icon.tsx'
import { toast } from '../components/Toast.tsx'
import { usePageTitle } from './usePageTitle.ts'
import { usePrefs } from '../lib/prefs.ts'
import { GOOGLE_CLIENT_ID } from '../lib/config.ts'
import { ownerKey, ownerRole, passwordLogin, staffForgot, staffReset, unlock } from '../lib/owner.ts'
import {
  isMobile,
  readerChangePassword,
  readerDeleteAccount,
  readerForgot,
  readerGoogle,
  readerRename,
  readerReset,
  readerSetContact,
  readerSignIn,
  readerSignOut,
  readerSignUp,
  readerState,
  refreshReader,
  syncNow,
  useReader,
} from '../lib/reader.ts'
import { timeAgo } from '../lib/format.ts'

type Mode = 'signin' | 'signup' | 'forgot' | 'reset' | 'key'

function Field({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  placeholder,
  hint,
  inputMode,
}: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  placeholder?: string
  hint?: string
  inputMode?: 'text' | 'email' | 'tel' | 'numeric'
}) {
  const [show, setShow] = useState(false)
  const pw = type === 'password'
  return (
    <label className="acct-field">
      <span>{label}</span>
      <span className="acct-input">
        <input type={pw && show ? 'text' : type} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} inputMode={inputMode} required />
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

/* ---------- Continue with Google (Google Identity Services, web only) ---------- */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: object) => void
          renderButton: (el: HTMLElement, o: object) => void
        }
      }
    }
  }
}
let gsiLoading: Promise<void> | null = null
const loadGsi = () =>
  (gsiLoading ??= new Promise<void>((resolve, reject) => {
    if (window.google?.accounts) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gsiLoading = null
      reject(new Error('Google sign-in could not load.'))
    }
    document.head.appendChild(s)
  }))

function GoogleButton({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  // Latest callbacks, so Google's button is set up only once.
  const cb = useRef({ onDone, onError })
  cb.current = { onDone, onError }
  useEffect(() => {
    let dead = false
    loadGsi()
      .then(() => {
        if (dead || !box.current || !window.google) return
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          ux_mode: 'popup',
          callback: (r: { credential?: string }) => {
            if (!r.credential) return cb.current.onError('Google sign-in was cancelled.')
            readerGoogle(r.credential).then(cb.current.onDone, (e: Error) => cb.current.onError(e.message))
          },
        })
        window.google.accounts.id.renderButton(box.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          logo_alignment: 'center',
          width: Math.min(380, box.current.clientWidth || 340),
        })
        setReady(true)
      })
      .catch((e: Error) => cb.current.onError(e.message))
    return () => {
      dead = true
    }
  }, [])
  return (
    <div className="acct-google">
      <div ref={box} className={ready ? '' : 'loading'} />
    </div>
  )
}
const showGoogle = !!GOOGLE_CLIENT_ID && !Capacitor.isNativePlatform()

/* ---------- signed out ---------- */

function SignedOut() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [f, setF] = useState({
    name: '',
    id: '',
    password: '',
    code: '',
    key: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The code was sent for a team login (then the reset opens R&M Newsroom).
  const [teamReset, setTeamReset] = useState(false)
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const go = (m: Mode) => {
    setMode(m)
    setError('')
  }
  const done = (welcome: string) => {
    // An account the owner gave Newsroom access goes straight to R&M Newsroom.
    const me = readerState()?.me
    if (me?.newsroom) {
      toast(`Welcome, ${me.name.split(' ')[0]}`)
      navigate('/studio', { replace: true })
      return
    }
    toast(welcome)
    navigate('/account', { replace: true })
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'key') {
        // The older team login key (given by the owner) opens R&M Newsroom.
        if (!(await unlock(f.key))) throw new Error('That login key does not work. Sign in with your mobile number or email and password instead.')
        toast('Welcome to R&M Newsroom')
        navigate('/studio', { replace: true })
        return
      }
      if (mode === 'signin') {
        // A team member's mobile number (or the email added in My profile) opens R&M Newsroom
        // with their usual team password; anything else is a reader account.
        if (isMobile(f.id) || f.id.includes('@')) {
          try {
            const who = await passwordLogin(f.id, f.password)
            toast(`Welcome, ${who.name.split(' ')[0]}`)
            navigate('/studio', { replace: true })
            return
          } catch (err) {
            if (!/^No (team )?login (on|with) this (mobile number|email)/i.test((err as Error).message)) throw err
          }
        }
        await readerSignIn(f.id, f.password)
        done('Signed in')
      } else if (mode === 'signup') {
        await readerSignUp(f.name, f.id, f.password)
        done('Welcome to Realty & More')
      } else if (mode === 'forgot') {
        // Team logins first: their code comes from the team system.
        const team = await staffForgot(f.id)
        if (team.matched) {
          if (!team.sent) {
            setError('Your team login has no email yet, so a code can’t be sent. Ask Palash sir for a new password, then add your email in R&M Newsroom → My profile.')
            return
          }
          setTeamReset(true)
          toast('A 6-digit code is on its way to your email.')
          setMode('reset')
          return
        }
        setTeamReset(false)
        const r = await readerForgot(f.id)
        if (r.noEmail) {
          setError('This account was made with a mobile number and has no email, so a code can’t be sent. Team members: ask Palash sir for a new password.')
          return
        }
        toast('If this account has an email, a 6-digit code is on its way.')
        setMode('reset')
      } else if (teamReset) {
        const who = await staffReset(f.id, f.code, f.password)
        toast(`Password changed. Welcome back, ${who.name.split(' ')[0]}`)
        navigate('/studio', { replace: true })
      } else {
        await readerReset(f.id, f.code, f.password)
        done('Password changed. You are signed in.')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const title = mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : mode === 'key' ? 'Team login key' : 'Enter the code'
  const mobile = isMobile(f.id)
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
        {mode === 'reset' && <p className="acct-note">We sent a 6-digit code to the email on this account. It works for 20 minutes. Check Spam if you don’t see it.</p>}
        {mode === 'forgot' && <p className="acct-note">Enter your email or mobile number. We’ll send a code to your account’s email to set a new password.</p>}
        {mode === 'signin' && <p className="acct-note">Realty &amp; More team: use your mobile number (or your added email) and team password.</p>}
        {mode === 'key' && <p className="acct-note">For Palash sir’s own login key (made in R&amp;M Newsroom → My profile) or a team login key. It opens R&amp;M Newsroom.</p>}

        {showGoogle && (mode === 'signin' || mode === 'signup') && (
          <>
            <GoogleButton onDone={() => done('Signed in with Google')} onError={setError} />
            <div className="acct-or">
              <span>or</span>
            </div>
          </>
        )}

        <form className="acct-form" onSubmit={(e) => void submit(e)}>
          {mode === 'key' && <Field label="Login key" type="password" value={f.key} onChange={set('key')} autoComplete="off" placeholder="Paste your login key" />}
          {mode === 'signup' && <Field label="Your name" value={f.name} onChange={set('name')} autoComplete="name" placeholder="e.g. Ananya Sharma" />}
          {mode !== 'key' && (
            <Field
              label="Email or mobile number"
              value={f.id}
              onChange={set('id')}
              autoComplete="username"
              placeholder="you@example.com or 98100 12345"
              inputMode={mobile ? 'tel' : 'email'}
              hint={mode === 'signup' && mobile ? 'Tip: add an email later in My account so you can reset your password.' : undefined}
            />
          )}
          {mode === 'reset' && (
            <Field label="6-digit code" value={f.code} onChange={(v) => set('code')(v.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" placeholder="000000" inputMode="numeric" />
          )}
          {mode !== 'forgot' && mode !== 'key' && (
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
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send code' : mode === 'key' ? 'Open Newsroom' : 'Set new password'}
          </button>
        </form>
        <div className="acct-links">
          {mode === 'signin' && (
            <>
              <button className="acct-link" onClick={() => go('forgot')}>
                Forgot password?
              </button>
              <button className="acct-link muted" onClick={() => go('key')}>
                Team login key
              </button>
            </>
          )}
          {(mode === 'forgot' || mode === 'reset' || mode === 'key') && (
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
          . We never share your email or number.
        </p>
      </section>
    </div>
  )
}

/* ---------- signed in ---------- */

function SignedIn() {
  const s = useReader()!
  const [prefs] = usePrefs()
  const navigate = useNavigate()
  const [syncing, setSyncing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(s.me.name)
  const [open, setOpen] = useState<'' | 'pw' | 'email' | 'phone' | 'del'>('')
  const [pw, setPw] = useState({ old: '', next: '' })
  const [contact, setContact] = useState({ value: '', password: '' })
  const [del, setDel] = useState({ password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000)
    // Newsroom access given or taken away since this device last checked.
    void refreshReader().catch(() => {})
    return () => clearInterval(t)
  }, [])
  const hasPw = s.me.hasPassword !== false
  // Signed in to the Newsroom too: show the Newsroom profile photo (the owner's default photo if none).
  const staff = ownerKey() ? ownerRole() : null
  const pic = staff?.photo || (staff?.role === 'owner' ? './brand/palash.jpg' : '')
  const initials = s.me.name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const since = new Date(s.me.created).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  })
  const toggle = (k: typeof open) => setOpen((o) => (o === k ? '' : k))
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
          {pic ? <img src={pic} alt="" width={72} height={72} /> : initials || '?'}
        </div>
        <div className="acct-who">
          {editing ? (
            <form
              className="acct-rename"
              onSubmit={(e) => {
                e.preventDefault()
                void run(
                  () => readerRename(name),
                  'Name saved',
                  () => setEditing(false),
                )
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
          <p>{[s.me.email, s.me.phone && `+91 ${s.me.phone.slice(0, 5)} ${s.me.phone.slice(5)}`].filter(Boolean).join(' · ')}</p>
          <small>
            Member since {since}
            {s.me.google ? ' · Signed in with Google' : ''}
          </small>
        </div>
      </section>

      {(s.me.newsroom || ownerKey()) && (
        <section className="acct-newsroom">
          <span className="acct-newsroom-icon" aria-hidden="true">
            <Icon name="sparkle" size={20} />
          </span>
          <div>
            <b>R&amp;M Newsroom</b>
            <small>
              {ownerRole()?.role === 'owner' ? 'Founder & Editor' : (s.me.newsroom ?? ownerRole()?.role) === 'admin' ? 'Full access' : 'Employee'} · you are signed in to the Newsroom too.
            </small>
          </div>
          <button className="btn small" onClick={() => navigate('/studio')}>
            Open Newsroom
          </button>
        </section>
      )}

      <section className="acct-sync">
        <span className={`acct-sync-dot ${syncing ? 'busy' : ''}`} aria-hidden="true" />
        <div>
          <b>{syncing ? 'Syncing…' : s.syncedAt ? 'Synced' : 'Not synced yet'}</b>
          <small>{s.syncedAt ? `Last synced ${timeAgo(s.syncedAt)}. Saved stories and your feed stay the same on every device.` : 'Your saved stories and feed will sync in a moment.'}</small>
        </div>
        <button
          className="btn ghost small"
          disabled={syncing}
          onClick={() => {
            setSyncing(true)
            syncNow()
              .then(
                () => toast('Everything is up to date'),
                (e: Error) => toast(e.message),
              )
              .finally(() => setSyncing(false))
          }}
        >
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
        {(['email', 'phone'] as const).map((k) => (
          <div key={k}>
            <button className="acct-row" onClick={() => toggle(k)} aria-expanded={open === k}>
              <Icon name={k === 'email' ? 'news' : 'whatsapp'} size={18} />
              <span>
                {k === 'email' ? (s.me.email ? 'Change email' : 'Add an email') : s.me.phone ? 'Change mobile number' : 'Add a mobile number'}
                <small>{k === 'email' ? s.me.email || 'Needed to reset your password if you forget it' : s.me.phone ? `+91 ${s.me.phone}` : 'Sign in with your number too'}</small>
              </span>
              <Icon name="chevron" size={16} />
            </button>
            {open === k && (
              <form
                className="acct-form acct-inline"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(
                    () => readerSetContact(k, contact.value, contact.password),
                    k === 'email' ? 'Email saved' : 'Mobile number saved',
                    () => {
                      setOpen('')
                      setContact({ value: '', password: '' })
                    },
                  )
                }}
              >
                <Field
                  label={k === 'email' ? 'Email' : 'Mobile number'}
                  type={k === 'email' ? 'email' : 'tel'}
                  value={contact.value}
                  onChange={(v) => setContact((x) => ({ ...x, value: v }))}
                  inputMode={k === 'email' ? 'email' : 'tel'}
                />
                {hasPw && <Field label="Your password" type="password" value={contact.password} onChange={(v) => setContact((x) => ({ ...x, password: v }))} autoComplete="current-password" />}
                <button className="btn small" disabled={busy}>
                  Save
                </button>
              </form>
            )}
          </div>
        ))}
        <button className="acct-row" onClick={() => toggle('pw')} aria-expanded={open === 'pw'}>
          <Icon name="settings" size={18} />
          <span>
            {hasPw ? 'Change password' : 'Set a password'}
            <small>{hasPw ? 'Use at least 8 characters, letters and numbers' : 'So you can also sign in with your email or number'}</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        {open === 'pw' && (
          <form
            className="acct-form acct-inline"
            onSubmit={(e) => {
              e.preventDefault()
              void run(
                () => readerChangePassword(pw.old, pw.next),
                hasPw ? 'Password changed' : 'Password set',
                () => {
                  setOpen('')
                  setPw({ old: '', next: '' })
                },
              )
            }}
          >
            {hasPw && <Field label="Current password" type="password" value={pw.old} onChange={(v) => setPw((x) => ({ ...x, old: v }))} autoComplete="current-password" />}
            <Field
              label="New password"
              type="password"
              value={pw.next}
              onChange={(v) => setPw((x) => ({ ...x, next: v }))}
              autoComplete="new-password"
              hint="At least 8 characters, with letters and numbers."
            />
            <button className="btn small" disabled={busy}>
              {hasPw ? 'Change password' : 'Set password'}
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
        <button className="acct-row danger" onClick={() => toggle('del')} aria-expanded={open === 'del'}>
          <Icon name="trash" size={18} />
          <span>
            Delete account
            <small>Removes your account and synced data for good</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        {open === 'del' && (
          <form
            className="acct-form acct-inline"
            onSubmit={(e) => {
              e.preventDefault()
              if (!window.confirm('Delete your account for good? This cannot be undone.')) return
              void run(
                () => readerDeleteAccount(del.password, del.confirm),
                'Account deleted',
                () => navigate('/account', { replace: true }),
              )
            }}
          >
            <p className="acct-note">Your name, email, number and synced list will be deleted. Stories saved on this device stay here.</p>
            {hasPw ? (
              <Field label="Password" type="password" value={del.password} onChange={(v) => setDel((x) => ({ ...x, password: v }))} autoComplete="current-password" />
            ) : (
              <Field label="Type DELETE to confirm" value={del.confirm} onChange={(v) => setDel((x) => ({ ...x, confirm: v }))} placeholder="DELETE" />
            )}
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
