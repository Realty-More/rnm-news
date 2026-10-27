// Weekly email newsletter sign-up (Home and Settings). Double opt-in: the reader confirms from email.
import { useState, type FormEvent } from 'react'
import { PUSH_API } from '../lib/push.ts'
import { Icon } from './Icon.tsx'

const KEY = 'rnm-newsletter'
const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function NewsletterCard({ compact = false }: { compact?: boolean }) {
  const [done, setDone] = useState<string | null>(read)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  if (!PUSH_API) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`${PUSH_API}/newsletter/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim(), source: compact ? 'settings' : 'home' }),
      })
      const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
      const text =
        data.status === 'already'
          ? 'You’re already subscribed.'
          : data.status === 'check-email'
            ? 'Almost done: open the email we just sent and tap “Yes, subscribe me”.'
            : 'Thank you! We’ll email you a link to confirm your subscription.'
      try {
        localStorage.setItem(KEY, email.trim())
      } catch {
        /* private mode */
      }
      setDone(email.trim())
      setMsg({ text })
    } catch (err) {
      setMsg({ text: navigator.onLine ? (err as Error).message : 'You are offline.', bad: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`nl-card ${compact ? 'compact' : ''}`} aria-labelledby="nl-h">
      <div className="nl-head">
        <span className="nl-icon" aria-hidden="true">
          <Icon name="news" size={20} />
        </span>
        <div>
          <h2 id="nl-h">The week in real estate</h2>
          <p>Free weekly email: the top stories, the new R&amp;M Magazine and videos. Unsubscribe any time.</p>
        </div>
      </div>
      {done && !msg ? (
        <p className="nl-done">
          ✓ Subscribed as <b>{done}</b>.{' '}
          <button
            className="link-btn"
            onClick={() => {
              setDone(null)
              setEmail('')
            }}
          >
            Use another email
          </button>
        </p>
      ) : msg && !msg.bad ? (
        <p className="nl-done">✓ {msg.text}</p>
      ) : (
        <form className="nl-form" onSubmit={submit}>
          {!compact && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" aria-label="Your name" autoComplete="name" maxLength={60} />}
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" placeholder="Your email" aria-label="Your email" autoComplete="email" maxLength={120} required />
          <button className="btn" disabled={busy || !email.includes('@')}>
            {busy ? 'Sending…' : 'Subscribe'}
          </button>
          {msg?.bad && <p className="nl-error">{msg.text}</p>}
          <p className="nl-small">
            We only use your email for this newsletter.{' '}
            <a href="https://realty-more.github.io/rnm-news/privacy.html" target="_blank" rel="noopener noreferrer">
              Privacy policy
            </a>
          </p>
        </form>
      )}
    </section>
  )
}
