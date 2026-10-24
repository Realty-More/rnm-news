import { useEffect, useState } from 'react'
import { disablePush, enablePush, pushAvailable, pushState, type PushState } from '../lib/push.ts'
import { Icon } from './Icon.tsx'
import { toast } from './Toast.tsx'

const HINTS: Record<PushState, string> = {
  on: 'You will get an alert when a new story is published.',
  off: 'Get an alert when a new story is published on realtynmore.com.',
  denied: 'Notifications are blocked. Allow them for this app in your phone or browser settings, then come back.',
  'ios-install': 'On iPhone, first add the app to your Home Screen (Share → Add to Home Screen), then turn this on from there.',
  unsupported: 'This browser does not support notifications.',
}

export function usePushState(): [PushState | null, (s: PushState) => void] {
  const [state, setState] = useState<PushState | null>(null)
  useEffect(() => {
    void pushState().then(setState, () => setState('unsupported'))
  }, [])
  return [state, setState]
}

export function NotifyToggle() {
  const [state, setState] = usePushState()
  const [busy, setBusy] = useState(false)
  if (!pushAvailable() || state === null) return null

  const toggle = async () => {
    setBusy(true)
    try {
      const next = state === 'on' ? await disablePush() : await enablePush()
      setState(next)
      if (next === 'on') toast('Breaking news alerts are on')
      else if (next === 'denied') toast('Notifications are blocked in settings')
      else if (state === 'on') toast('Alerts turned off')
    } catch {
      toast('Could not change alerts right now. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className="set-row toggle">
      <span>
        Breaking news alerts
        <small>{HINTS[state]}</small>
      </span>
      <input type="checkbox" checked={state === 'on'} disabled={busy || state === 'denied' || state === 'ios-install' || state === 'unsupported'} onChange={toggle} />
    </label>
  )
}

/** One-time card on Home inviting readers to turn alerts on. */
export function NotifyPrompt() {
  const [state, setState] = usePushState()
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('rnm-notify-prompt') === 'done'
    } catch {
      return false
    }
  })
  if (hidden || !pushAvailable() || state !== 'off') return null
  const close = () => {
    setHidden(true)
    try {
      localStorage.setItem('rnm-notify-prompt', 'done')
    } catch {
      /* ignore */
    }
  }
  const turnOn = async () => {
    try {
      const next = await enablePush()
      setState(next)
      if (next === 'on') toast('Breaking news alerts are on')
    } catch {
      toast('Could not turn on alerts right now')
    }
    close()
  }
  return (
    <div className="notify-card">
      <span className="notify-bell">
        <Icon name="bell" size={20} />
      </span>
      <div className="notify-text">
        <strong>Get breaking news alerts</strong>
        <span>We’ll notify you when a new story is published.</span>
      </div>
      <button className="btn small" onClick={turnOn}>
        Turn on
      </button>
      <button className="icon-btn" onClick={close} aria-label="Not now">
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}
