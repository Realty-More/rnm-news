import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon.tsx'
import { toast } from '../components/Toast.tsx'
import { TopicPicker } from '../components/TopicPicker.tsx'
import { NotifyToggle } from '../components/NotifyToggle.tsx'
import { pushAvailable } from '../lib/push.ts'
import { formatDateTime } from '../lib/format.ts'
import { clearHistory } from '../lib/history.ts'
import { offlineInfo, refreshOffline } from '../lib/offline.ts'
import { TEXT_SIZES, usePrefs, useTheme, type ThemePref } from '../lib/prefs.ts'
import { CHANNEL_URL } from '../lib/youtubeFeed.ts'
import { SITE } from '../lib/wp.ts'
import { usePageTitle } from './usePageTitle.ts'

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]
const SIZE_LABELS = ['Small', 'Default', 'Large', 'Extra large']

export function Settings() {
  usePageTitle('Settings')
  const [prefs, update] = usePrefs()
  const [theme, setTheme] = useTheme()
  const [offline, setOffline] = useState<{ at: string; count: number } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void offlineInfo().then(setOffline)
  }, [])

  const downloadNow = async () => {
    setBusy(true)
    try {
      const n = await refreshOffline(true)
      setOffline(await offlineInfo())
      toast(n ? `${n} latest stories saved for offline reading` : 'You are offline')
    } catch {
      toast('Could not download stories right now')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page settings">
      <div className="page-head">
        <h1>Settings</h1>
        <p className="page-sub">Saved on this device only</p>
      </div>

      <section className="set-group">
        <h2 className="set-title">My Feed</h2>
        <p className="set-help">Pick sections and cities. Home shows a “For You” feed built from them.</p>
        <TopicPicker topics={prefs.topics} cities={prefs.cities} onChange={(topics, cities) => update({ topics, cities, onboarded: true })} />
      </section>

      {pushAvailable() && (
        <section className="set-group">
          <h2 className="set-title">Notifications</h2>
          <NotifyToggle />
        </section>
      )}

      <section className="set-group">
        <h2 className="set-title">Appearance</h2>
        <div className="set-row">
          <span>Theme</span>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.value} role="radio" aria-checked={theme === t.value} className={theme === t.value ? 'on' : ''} onClick={() => setTheme(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <span>Article text size</span>
          <div className="stepper">
            <button className="icon-btn" aria-label="Smaller text" disabled={prefs.textSize === 0} onClick={() => update({ textSize: prefs.textSize - 1 })}>
              A−
            </button>
            <span className="stepper-value">{SIZE_LABELS[prefs.textSize]}</span>
            <button className="icon-btn" aria-label="Larger text" disabled={prefs.textSize === TEXT_SIZES.length - 1} onClick={() => update({ textSize: prefs.textSize + 1 })}>
              A+
            </button>
          </div>
        </div>
        <p className="set-preview" style={{ fontSize: TEXT_SIZES[prefs.textSize] }}>
          Preview: this is how article text will look.
        </p>
      </section>

      <section className="set-group">
        <h2 className="set-title">Offline reading</h2>
        <label className="set-row toggle">
          <span>
            Auto-download latest stories
            <small>Every 3 hours when online. Skipped when Data Saver is on.</small>
          </span>
          <input type="checkbox" checked={prefs.autoOffline} onChange={(e) => update({ autoOffline: e.target.checked })} />
        </label>
        <div className="set-row">
          <span>
            {offline ? `${offline.count} stories downloaded` : 'Nothing downloaded yet'}
            {offline && <small>{formatDateTime(offline.at)}</small>}
          </span>
          <button className="btn ghost small" onClick={downloadNow} disabled={busy}>
            <Icon name="download" size={16} /> {busy ? 'Downloading…' : 'Download now'}
          </button>
        </div>
      </section>

      <section className="set-group">
        <h2 className="set-title">Privacy</h2>
        <div className="set-row">
          <span>
            Reading history
            <small>Used for “Continue reading”. Never leaves this device.</small>
          </span>
          <button
            className="btn ghost small"
            onClick={() => {
              clearHistory()
              toast('Reading history cleared')
            }}
          >
            Clear
          </button>
        </div>
      </section>

      <section className="set-group about">
        <h2 className="set-title">About</h2>
        <p>
          All news, photos and dates come from{' '}
          <a href={SITE} target="_blank" rel="noopener noreferrer">
            realtynmore.com
          </a>
          . Videos and podcasts come from the{' '}
          <a href={CHANNEL_URL} target="_blank" rel="noopener noreferrer">
            Realty &amp; More YouTube channel
          </a>
          . The app has no ads and no tracking, and keeps no account.
        </p>
        <p className="meta">Version {__APP_VERSION__}</p>
      </section>
    </div>
  )
}
