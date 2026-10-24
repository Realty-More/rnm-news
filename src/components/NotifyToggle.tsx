import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n.ts'
import { disablePush, enablePush, pushAvailable, pushState, type PushState } from '../lib/push.ts'
import { usePrefs } from '../lib/prefs.ts'
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
  const [prefs, update] = usePrefs()
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

  const feedEmpty = prefs.topics.length === 0 && prefs.cities.length === 0
  return (
    <>
      <label className="set-row toggle">
        <span>
          Breaking news alerts
          <small>{HINTS[state]}</small>
        </span>
        <input type="checkbox" checked={state === 'on'} disabled={busy || state === 'denied' || state === 'ios-install' || state === 'unsupported'} onChange={toggle} />
      </label>
      {state === 'on' && (
        <div className="set-row">
          <span>
            Alert me about
            <small>
              {prefs.notifyMode === 'feed'
                ? feedEmpty
                  ? 'Pick sections or cities in My Feed above, otherwise you get every story.'
                  : 'Only stories from your My Feed sections and cities.'
                : 'Every new story.'}
            </small>
          </span>
          <div className="segmented small" role="radiogroup" aria-label="Alert me about">
            <button role="radio" aria-checked={prefs.notifyMode === 'all'} className={prefs.notifyMode === 'all' ? 'on' : ''} onClick={() => update({ notifyMode: 'all' })}>
              All news
            </button>
            <button role="radio" aria-checked={prefs.notifyMode === 'feed'} className={prefs.notifyMode === 'feed' ? 'on' : ''} onClick={() => update({ notifyMode: 'feed' })}>
              My Feed
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/** One-time card on Home inviting readers to turn alerts on. */
export function NotifyPrompt() {
  const [state, setState] = usePushState()
  const t = useT()
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
        <strong>{t('notify.cardTitle')}</strong>
        <span>{t('notify.cardText')}</span>
      </div>
      <button className="btn small" onClick={turnOn}>
        {t('notify.turnOn')}
      </button>
      <button className="icon-btn" onClick={close} aria-label="Not now">
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}
