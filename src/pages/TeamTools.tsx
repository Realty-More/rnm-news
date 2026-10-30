// Team attendance and daily work reports in the Content Studio.
// Employees: "My day" (check in/out, daily report). Owner: "Team today" and monthly "Attendance" with CSV export.
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDate } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { studio, studioPost } from '../lib/owner.ts'
import { getSpot, mapLink } from '../lib/location.ts'
import { PersonAvatar } from '../components/PersonAvatar.tsx'
import { AddEmployeeDialog, Dialog, RowMenu } from './EmployeesTools.tsx'
import { buzz, confetti, firstToday } from '../lib/confetti.ts'

// The map (Leaflet + OpenStreetMap) loads only when someone opens it.
const FieldMap = lazy(() => import('./FieldMap.tsx'))
import { ensureSubscription } from '../lib/push.ts'
import { Panel } from './StudioTools.tsx'
import { MyTasksPanel } from './WorkTools.tsx'

const IST = 'Asia/Kolkata'
const clock = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)) : '–')
const hours = (min: number) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : '–')
const MODE_LABEL: Record<string, string> = { office: 'Office', remote: 'Work from home', field: 'Field / site visit' }
const todayIst = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)

interface Today {
  day: string
  name: string
  attendance: { check_in: string | null; check_out: string | null; mode: string | null; note: string | null } | null
  report: { done: string; plan: string; blockers: string; links: string; submitted_at: string } | null
  settings: { startTime: string; endTime?: string; graceMin: number; reminderTime: string; weekOff?: number[]; requireLocation?: boolean; offices?: Office[] }
  place?: { in: Place | null; out: Place | null }
  late: boolean
  minutes: number
}
interface Office {
  name: string
  lat: number
  lng: number
  radius: number
}
interface Place {
  lat: number
  lng: number
  acc: number
  office: string | null
  meters: number | null
  label: string
}

/** "📍 At Noida Office" with a map link, or a note that no location was shared. */
function PlaceTag({ p, missing = 'No location' }: { p: Place | null | undefined; missing?: string }) {
  if (!p) return <span className="place-tag none">{missing}</span>
  // Green at an office, amber when away from one, plain when no office is set up.
  return (
    <a className={`place-tag ${p.office ? 'in' : p.meters === null ? 'plain' : 'away'}`} href={mapLink(p)} target="_blank" rel="noopener noreferrer" title={`Accuracy about ${p.acc} m. Open in Google Maps`}>
      📍 {p.label}
    </a>
  )
}

/* ---------- shared: times and the shift bar ---------- */

/** "11:00" → minutes after midnight. */
const toMin = (hhmm: string | undefined, fallback = 0) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback
}
/** Minutes after midnight in IST for a timestamp (or now). */
const istMin = (iso?: string | null) => {
  const d = new Date((iso ? Date.parse(iso) : Date.now()) + 5.5 * 3600000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
const hm = (min: number) => `${Math.floor(Math.abs(min) / 60)}h ${String(Math.abs(min) % 60).padStart(2, '0')}m`
const label12 = (min: number) => {
  const h = Math.floor(min / 60) % 24
  return `${h % 12 || 12}${min % 60 ? `:${String(min % 60).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}
const greeting = () => {
  const h = Math.floor(istMin() / 60)
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
const longDay = (day: string) => new Date(`${day}T06:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: IST })
const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T06:00:00Z`) + by * 86400000).toISOString().slice(0, 10)

/** A number that counts up to its value when it first shows (skipped if the phone asks for less motion). */
function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setV(target)
    let raf = 0
    const t0 = performance.now()
    const from = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}
const Count = ({ n, fmt }: { n: number; fmt?: (v: number) => string }) => {
  const v = useCountUp(n)
  return <>{fmt ? fmt(v) : v}</>
}

/** One day on a strip: the shift (light), time worked (green; the late part orange) and, today, a "now" line. */
function ShiftBar({ from, to, start, end, inAt, outAt, now, grace = 0, hours = true }: { from: number; to: number; start: number; end: number; inAt: number | null; outAt: number | null; now: number | null; grace?: number; hours?: boolean }) {
  const span = Math.max(60, to - from)
  const x = (m: number) => `${Math.max(0, Math.min(100, ((m - from) / span) * 100))}%`
  const w = (a: number, b: number) => `${Math.max(0, Math.min(100, ((Math.min(b, to) - Math.max(a, from)) / span) * 100))}%`
  const workedTo = outAt ?? now
  const ticks: number[] = []
  for (let t = Math.ceil(from / 60) * 60; t <= to; t += 60) ticks.push(t)
  const lateStart = inAt !== null && inAt > start + grace
  return (
 <div className={`sb ${inAt !== null && outAt === null && now !== null ? 'live' : ''}`} role="img" aria-label={`Shift ${label12(start)} to ${label12(end)}${inAt !== null ? `, checked in ${label12(inAt)}` : ', not checked in'}${outAt !== null ? `, checked out ${label12(outAt)}` : ''}`}>
      <div className="sb-track">
        {ticks.map((t) => (
          <i key={t} className="sb-tick" style={{ left: x(t) }} />
        ))}
        <span className="sb-shift" style={{ left: x(start), width: w(start, end) }} />
        {inAt !== null && workedTo !== null && workedTo > inAt && (
          <>
            <span className="sb-work" style={{ left: x(inAt), width: w(inAt, workedTo) }} />
            {lateStart && <span className="sb-late" style={{ left: x(start), width: w(start, inAt) }} />}
          </>
        )}
        {inAt !== null && <b className="sb-dot in" style={{ left: x(inAt) }} title={`In ${label12(inAt)}`} />}
        {outAt !== null && <b className="sb-dot out" style={{ left: x(outAt) }} title={`Out ${label12(outAt)}`} />}
        {now !== null && now >= from && now <= to && <em className="sb-now" style={{ left: x(now) }} title={`Now ${label12(now)}`} />}
      </div>
      {hours && (
        <div className="sb-hours" aria-hidden="true">
          {ticks
            .filter((_, i) => i % (span > 600 ? 2 : 1) === 0)
            .map((t, i) => (
              <span key={t} className={i % 2 ? 'odd' : ''} style={{ left: x(t) }}>
                {label12(t).replace(':00', '')}
              </span>
            ))}
        </div>
      )}
    </div>
  )
}

/** Small line icons for the My day tiles (24 px grid). */
const MD_ICON: Record<string, string> = {
  in: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  office: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1',
  remote: 'M3 11l9-8 9 8M5 10v11h14V10M10 21v-6h4v6',
  field: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
}
function MdIcon({ name, tone = 'gold' }: { name: string; tone?: 'gold' | 'green' | 'orange' | 'blue' }) {
  return (
    <span className={`md-ico ${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d={MD_ICON[name] ?? MD_ICON.flag} />
      </svg>
    </span>
  )
}

/** Time since check-in, ticking every second (shown inside the ring while working). */
function LiveDuration({ since, part = 'hm' }: { since: string; part?: 'hm' | 's' }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
  if (part === 's') return <span className="md-sec">{String(s % 60).padStart(2, '0')}s</span>
  return (
    <>
      {Math.floor(s / 3600)}h {String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m
    </>
  )
}

/** A ring that fills as the shift's hours are worked. */
function Ring({ value, total, children, live = false }: { value: number; total: number; children: ReactNode; live?: boolean }) {
  const r = 52
  const c = 2 * Math.PI * r
  const pct = total > 0 ? Math.min(1, value / total) : 0
  // Starts empty and fills, so the ring sweeps round when the page opens.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(t)
  }, [])
  return (
    <div className={`md-ring ${live ? 'live' : ''}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id="md-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFD36B" />
            <stop offset="55%" stopColor="#FBA519" />
            <stop offset="100%" stopColor="#F2711C" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={r} className="md-ring-bg" />
        <circle cx="60" cy="60" r={r} className="md-ring-fg" stroke="url(#md-ring-grad)" strokeDasharray={c} strokeDashoffset={shown ? c * (1 - pct) : c} />
        {pct > 0.01 && (
          <g className="md-ring-cap" style={{ transform: `rotate(${shown ? pct * 360 : 0}deg)` }}>
            <circle cx={60 + r} cy="60" r="7" className="md-ring-cap-glow" />
            <circle cx={60 + r} cy="60" r="4" className="md-ring-cap-dot" />
          </g>
        )}
      </svg>
      <div className="md-ring-text">{children}</div>
    </div>
  )
}

/* ---------- employee: My day ---------- */
export function MyDayTab() {
  const res = useAsync('studio:myday', (s) => studio<Today>('me/today', undefined, s))
  const hist = useAsync('studio:myhistory', (s) => studio<{ days: { day: string; checkIn: string | null; checkOut: string | null; late: boolean; minutes: number; report: string | null }[] }>('me/history', undefined, s))
  const [mode, setMode] = useState('office')
  const [dayDone, setDayDone] = useState<{ minutes: number; inAt: string; outAt: string; report: boolean; full: boolean } | null>(null)
  const shiftLenRef = useRef(480)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ done: '', plan: '', blockers: '', links: '' })
  const [, tick] = useState(0)

  useEffect(() => {
    const r = res.data?.report
    if (r) setForm({ done: r.done, plan: r.plan, blockers: r.blockers, links: r.links })
  }, [res.data?.report])
  // Live timer while checked in.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const act = async (path: string, body: unknown, done: string) => {
    setBusy(true)
    try {
      const r = await studioPost<{ ok?: boolean; error?: string; late?: boolean; minutes?: number; report?: unknown; attendance?: { check_in: string | null; check_out: string | null } }>(path, body)
      if (r.ok === false) throw new Error(r.error)
      toast(done)
      // On time: a small celebration. A finished day: a summary card (confetti for a full shift).
      if (path === 'me/checkin' && !r.late) {
        confetti()
        buzz([20, 40, 20])
      }
      if (path === 'me/checkout' && r.attendance?.check_in) {
        const full = (r.minutes ?? 0) >= shiftLenRef.current * 0.95
        setDayDone({ minutes: r.minutes ?? 0, inAt: r.attendance.check_in, outAt: r.attendance.check_out ?? new Date().toISOString(), report: !!r.report, full })
        if (full) confetti(180)
        buzz(full ? [30, 50, 30, 50, 60] : 30)
      }
      res.reload()
      hist.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const sendReport = (e: FormEvent) => {
    e.preventDefault()
    void act('me/report', form, 'Report saved')
  }

  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data) return <SkeletonList count={3} />
  const d = res.data
  const a = d.attendance
  const isToday = d.day === todayIst()
  const now = isToday ? istMin() : null
  const live = a?.check_in && !a.check_out ? Math.round((Date.now() - Date.parse(a.check_in)) / 60000) : d.minutes
  const start = toMin(d.settings.startTime, 600)
  const end = toMin(d.settings.endTime, start + 480)
  const shiftLen = Math.max(60, end - start)
  shiftLenRef.current = shiftLen
  const inAt = a?.check_in ? istMin(a.check_in) : null
  const outAt = a?.check_out ? istMin(a.check_out) : null
  const from = Math.max(0, Math.floor((Math.min(start, inAt ?? start) - 60) / 60) * 60)
  const to = Math.min(24 * 60, Math.ceil((Math.max(end, outAt ?? end, now ?? 0) + 60) / 60) * 60)
  const lateBy = inAt !== null ? inAt - start : 0
  const left = end - (now ?? end)
  const reminder = toMin(d.settings.reminderTime, end + 30)

  // This week, Monday to Sunday, from the last 30 days.
  const days = hist.data?.days ?? []
  const byDay = new Map(days.map((h) => [h.day, h]))
  const todayDate = new Date(`${d.day}T06:00:00Z`)
  const monday = shiftDay(d.day, -((todayDate.getUTCDay() + 6) % 7))
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(monday, i)).map((day) => ({ day, h: day === d.day ? { day, checkIn: a?.check_in ?? null, checkOut: a?.check_out ?? null, late: d.late, minutes: live, report: d.report ? 'yes' : null } : byDay.get(day) }))
  const worked = week.filter((w) => w.h?.checkIn)
  const avg = worked.length ? Math.round(worked.reduce((n, w) => n + (w.h?.minutes ?? 0), 0) / worked.length) : 0
  const weekOff = d.settings.weekOff ?? [0]
  const maxBar = Math.max(shiftLen, ...worked.map((w) => w.h?.minutes ?? 0))

  return (
    <>
      <section className="md-hero">
        <div className="md-top">
          <div className="md-hello">
            <span className="md-date">{longDay(d.day)}</span>
            <h2>
              {greeting()}, {d.name.split(' ')[0]}
            </h2>
            <p>
              Shift {d.settings.startTime}–{d.settings.endTime ?? '–'} · grace {d.settings.graceMin} min · report reminder {d.settings.reminderTime}
            </p>
          </div>
          <Ring value={live} total={shiftLen} live={!!a?.check_in && !a.check_out}>
            <b>{a?.check_in && !a.check_out ? <LiveDuration since={a.check_in} /> : a?.check_in ? hm(live) : '0h 00m'}</b>
            <span>of {hm(shiftLen)}</span>
            {a?.check_in && !a.check_out && (
              <em className="md-live">
                <i aria-hidden="true" />
                Live <LiveDuration since={a.check_in} part="s" />
              </em>
            )}
          </Ring>
        </div>

        <ShiftBar from={from} to={to} start={start} end={end} inAt={inAt} outAt={outAt} now={now} grace={d.settings.graceMin} />

        {!a?.check_in ? (
          <div className="md-checkin">
            <p className="md-hint">{now !== null && now > start + d.settings.graceMin ? `Your shift started at ${d.settings.startTime}. Check in now.` : `Your shift starts at ${d.settings.startTime}.`}</p>
            <div className="segmented" role="radiogroup" aria-label="Work mode">
              {Object.entries(MODE_LABEL).map(([k, v]) => (
                <button key={k} role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>
                  {v}
                </button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. site visit at Sector 150" maxLength={140} aria-label="Note" />
            <button
              className="btn big-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const loc = await getSpot()
                setBusy(false)
                if (!loc && d.settings.requireLocation) return toast('Please allow location for this app, then check in again.')
                void act('me/checkin', { mode, note, loc }, loc ? 'Checked in' : 'Checked in (location not shared)')
              }}
            >
              <Icon name="clock" size={20} /> {busy ? 'Getting location…' : 'Check in'}
            </button>
            <p className="md-fine">📍 Your location is saved only when you check in and check out, never in between. Only the owner sees it.</p>
          </div>
        ) : (
          <div className="md-facts">
            <div>
              <div className="md-fact-head">
                <MdIcon name="in" tone={d.late ? 'orange' : 'green'} />
                <small>Checked in</small>
              </div>
              <b>{clock(a.check_in)}</b>
              <span className={`md-chip ${d.late ? 'warn' : 'ok'}`}>{d.late ? `Late by ${hm(lateBy)}` : 'On time'}</span>
            </div>
            <div>
              <div className="md-fact-head">
                <MdIcon name={a.mode === 'remote' ? 'remote' : a.mode === 'field' ? 'field' : 'office'} tone="blue" />
                <small>Working from</small>
              </div>
              <b>{MODE_LABEL[a.mode ?? 'office']}</b>
              <PlaceTag p={d.place?.in} missing="Location not shared" />
            </div>
            <div className="md-fact-wide">
              <div className="md-fact-head">
                <MdIcon name={a.check_out ? 'out' : 'flag'} tone="gold" />
                <small>{a.check_out ? 'Checked out' : 'Shift ends'}</small>
              </div>
              <b>{a.check_out ? clock(a.check_out) : d.settings.endTime ?? '–'}</b>
              {!a.check_out && now !== null && <span className="md-chip">{left > 0 ? `${hm(left)} to go` : `${hm(-left)} over`}</span>}
              {shiftLen > 0 && (
                <div className="md-prog" role="img" aria-label={`${Math.min(100, Math.round((live / shiftLen) * 100))}% of the shift done`}>
                  <div className="md-prog-track">
                    <i style={{ width: `${Math.min(100, Math.round((live / shiftLen) * 100))}%` }} />
                  </div>
                  <span>{Math.min(100, Math.round((live / shiftLen) * 100))}% of shift</span>
                </div>
              )}
              {a.check_out && <PlaceTag p={d.place?.out} missing="Location not shared" />}
            </div>
            {!a.check_out && (
              <button
                className="btn md-out"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  const loc = await getSpot()
                  setBusy(false)
                  if (!loc && d.settings.requireLocation) return toast('Please allow location for this app, then check out again.')
                  void act('me/checkout', { loc }, d.report ? 'Checked out. Have a good evening!' : 'Checked out. Please add your report.')
                }}
              >
                <Icon name="clock" size={18} /> {busy ? 'Getting location…' : 'Check out'}
              </button>
            )}
          </div>
        )}
      </section>

      {dayDone && (
        <Dialog title={dayDone.full ? 'Great day!' : 'Checked out'} onClose={() => setDayDone(null)}>
          <div className="day-done">
            <div className="day-done-hero">
              <span className="day-done-emoji" aria-hidden="true">
                {dayDone.full ? '🎉' : '👋'}
              </span>
              <b>{hm(dayDone.minutes)}</b>
              <small>{dayDone.full ? `Full shift done, ${d.name.split(' ')[0]}. Well done!` : `Thanks, ${d.name.split(' ')[0]}. See you tomorrow.`}</small>
            </div>
            <div className="day-done-stats">
              <span>
                <small>In</small>
                {clock(dayDone.inAt)}
              </span>
              <span>
                <small>Out</small>
                {clock(dayDone.outAt)}
              </span>
              <span>
                <small>Report</small>
                {dayDone.report ? '✓ Sent' : 'Not yet'}
              </span>
            </div>
            <div className="action-row">
              {!dayDone.report && (
                <button
                  className="btn"
                  onClick={() => {
                    setDayDone(null)
                    document.querySelector('.md-report, form.report-form, #report')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  Add today’s report
                </button>
              )}
              <button className={`btn ${dayDone.report ? '' : 'ghost'}`} onClick={() => setDayDone(null)}>
                Done
              </button>
            </div>
          </div>
        </Dialog>
      )}

      <section className="panel md-week" aria-label="This week">
        <div className="panel-head">
          <h2>This week</h2>
          <span className="md-week-sum">
            {worked.length} day{worked.length === 1 ? '' : 's'} · avg {hm(avg)} · {worked.filter((w) => w.h?.late).length} late · {worked.filter((w) => w.h?.report).length}/{worked.length} reports
          </span>
        </div>
        <div className="md-bars">
          {week.map(({ day, h }, i) => {
            const off = weekOff.includes(new Date(`${day}T06:00:00Z`).getUTCDay())
            const future = day > d.day
            return (
              <div key={day} className={`md-bar ${day === d.day ? 'today' : ''} ${future ? 'future' : ''}`} style={{ '--i': i } as CSSProperties}>
                <div className="md-bar-col">
                  <span className={`md-bar-fill ${h?.late ? 'late' : ''}`} style={{ height: h?.checkIn ? `${Math.max(6, ((h.minutes ?? 0) / maxBar) * 100)}%` : 0 }} />
                </div>
                <b>{h?.checkIn ? `${Math.floor((h.minutes ?? 0) / 60)}:${String((h.minutes ?? 0) % 60).padStart(2, '0')}` : off ? 'Off' : future ? '' : '–'}</b>
                <span>
                  {new Date(`${day}T06:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: IST })}
                  {h?.report ? ' ✓' : ''}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <MyTasksPanel />
      <Panel
        title="Today’s work report"
        note="Your report goes only to the owner."
        actions={<span className={`md-chip solid ${d.report ? 'ok' : now !== null && now >= reminder ? 'warn' : ''}`}>{d.report ? `Submitted ${clock(d.report.submitted_at)}` : `Due by ${d.settings.reminderTime}`}</span>}
      >
        <form className="form-grid one md-report" onSubmit={sendReport}>
          <label>
            What did you work on today?
            <textarea rows={4} value={form.done} onChange={(e) => setForm({ ...form, done: e.target.value })} placeholder="e.g. Wrote 3 RERA stories, edited the DLF interview, posted 2 reels" maxLength={2000} />
            <small className="md-count">{form.done.length}/2000</small>
          </label>
          <div className="md-two">
            <label>
              Plan for tomorrow <small>optional</small>
              <textarea rows={2} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} />
            </label>
            <label>
              Anything blocking you? <small>optional</small>
              <textarea rows={2} value={form.blockers} onChange={(e) => setForm({ ...form, blockers: e.target.value })} />
            </label>
          </div>
          <label>
            Links to your work <small>optional</small>
            <input value={form.links} onChange={(e) => setForm({ ...form, links: e.target.value })} placeholder="Story or video links, separated by spaces" />
          </label>
          <div className="action-row">
            <button className="btn" disabled={busy || form.done.trim().length < 3}>
              {d.report ? 'Update report' : 'Submit report'}
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Reminders on this phone" note="Notifications if you haven’t checked in by your office time, a report reminder, and a check-out reminder if you’re still checked in after your day ends.">
        <button
          className="btn ghost small"
          onClick={async () => {
            try {
              const sub = await ensureSubscription()
              if (!sub) return toast('Allow notifications first')
              await studioPost('me/device', { subscription: sub.toJSON() })
              toast('Reminders are on for this phone')
            } catch (e) {
              toast((e as Error).message)
            }
          }}
        >
          <Icon name="bell" size={16} /> Turn on reminders
        </button>
      </Panel>

      <Panel title="My last 30 days">
        {!hist.data ? (
          <SkeletonList count={2} />
        ) : hist.data.days.length === 0 ? (
          <p className="empty">No attendance yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="score-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Hours</th>
                  <th>Report</th>
                </tr>
              </thead>
              <tbody>
                {hist.data.days.map((h) => (
                  <tr key={h.day}>
                    <td>{formatDate(`${h.day}T06:00:00Z`)}</td>
                    <td>
                      {clock(h.checkIn)} {h.late && <em className="late">Late</em>}
                    </td>
                    <td>{clock(h.checkOut)}</td>
                    <td>{hours(h.minutes)}</td>
                    <td>{h.report ? '✓' : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

/* ---------- owner: Team today ---------- */
interface TeamDay {
  day: string
  settings: { startTime: string; endTime?: string; graceMin: number; reminderTime: string; weekOff?: number[]; offices?: Office[] }
  summary: { total: number; present: number; late: number; reports: number; onLeave?: number }
  people: {
    id: string
    name: string
    checkIn: string | null
    checkOut: string | null
    mode: string | null
    note: string | null
    late: boolean
    inPlace?: Place | null
    outPlace?: Place | null
    photo?: string | null
    avatar?: string | null
    title?: string | null
    start?: string
    end?: string
    minutes: number
    report: { done: string; plan: string; blockers: string; links: string; submittedAt: string } | null
    activity: string[]
    leave?: { kind: string; half: boolean } | null
    tasks?: { done: string[]; open: number; overdue: number }
  }[]
}
type Person = TeamDay['people'][number]
type Filter = 'all' | 'working' | 'missing' | 'late' | 'pending'

/** Where a person stands today, in words and a colour. */
function standing(p: Person, isToday: boolean, now: number, start: number, grace: number): { label: string; tone: 'live' | 'done' | 'wait' | 'warn' | 'leave' | 'off' } {
  if (p.checkIn && !p.checkOut) return { label: isToday ? 'Working now' : 'No check-out', tone: isToday ? 'live' : 'warn' }
  if (p.checkIn) return { label: 'Done for the day', tone: 'done' }
  if (p.leave) return { label: `On leave${p.leave.half ? ' · half day' : ''}`, tone: 'leave' }
  if (!isToday) return { label: 'Absent', tone: 'warn' }
  if (now < start) return { label: `Starts ${label12(start)}`, tone: 'wait' }
  if (now <= start + grace) return { label: 'Due now', tone: 'wait' }
  return { label: `Not in · ${hm(now - start)} past start`, tone: 'warn' }
}

export function TeamTodayTab() {
  const [date, setDate] = useState(todayIst)
  const [filter, setFilter] = useState<Filter>('all')
  const [, tick] = useState(0)
  const res = useAsync(`studio:teamday:${date}`, (s) => studio<TeamDay>(`team/day?date=${date}`, undefined, s))
  const d = res.data
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60000)
    return () => clearInterval(t)
  }, [])
  const isToday = date === todayIst()
  const now = istMin()
  /** Fix a mistaken check-out, or clear the day so they can check in again. */
  const resetAtt = async (personId: string, name: string, what: 'checkout' | 'all') => {
    const first = name.split(' ')[0]
    const ask =
      what === 'checkout'
        ? `Undo ${first}’s check-out? They will show as checked in again and can check out later.`
        : `Reset ${first}’s attendance for ${date}? The check-in and check-out are cleared and they can check in again.`
    if (!window.confirm(ask)) return
    try {
      await studioPost('team/attendance-reset', { personId, day: date, what })
      toast(what === 'checkout' ? `${first} is checked in again` : `${first}’s attendance for the day is cleared`)
      res.reload()
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const officeStart = toMin(d?.settings.startTime, 600)
  const officeEnd = toMin(d?.settings.endTime, officeStart + 480)
  const grace = d?.settings.graceMin ?? 15

  const rows = (d?.people ?? []).map((p) => {
    const start = toMin(p.start, officeStart)
    const end = toMin(p.end, officeEnd)
    const inAt = p.checkIn ? istMin(p.checkIn) : null
    const outAt = p.checkOut ? istMin(p.checkOut) : null
    const minutes = p.checkIn && !p.checkOut && isToday ? Math.round((Date.now() - Date.parse(p.checkIn)) / 60000) : p.minutes
    return { p, start, end, inAt, outAt, minutes, st: standing(p, isToday, now, start, grace) }
  })
  const from = Math.max(0, Math.floor((Math.min(...rows.flatMap((r) => [r.start, r.inAt ?? r.start]), officeStart) - 30) / 60) * 60)
  const to = Math.min(24 * 60, Math.ceil((Math.max(...rows.flatMap((r) => [r.end, r.outAt ?? r.end]), officeEnd, isToday ? now : 0) + 30) / 60) * 60)
  const count = {
    working: rows.filter((r) => r.p.checkIn && !r.p.checkOut).length,
    missing: rows.filter((r) => !r.p.checkIn && !r.p.leave).length,
    late: rows.filter((r) => r.p.late).length,
    pending: rows.filter((r) => r.p.checkIn && !r.p.report).length,
  }
  const shown = rows.filter((r) => (filter === 'working' ? r.p.checkIn && !r.p.checkOut : filter === 'missing' ? !r.p.checkIn && !r.p.leave : filter === 'late' ? r.p.late : filter === 'pending' ? r.p.checkIn && !r.p.report : true))
  const present = d?.summary.present ?? 0
  const total = d?.summary.total ?? 0
  const due = rows.filter((r) => !r.p.leave)
  const [mapOpen, setMapOpen] = useState(false)
  const located = rows.filter((r) => r.p.inPlace || r.p.outPlace)
  const unlocated = rows.filter((r) => r.p.checkIn && !r.p.inPlace)
  const allIn = isToday && due.length > 0 && due.every((r) => r.p.checkIn) && count.late === 0
  const allReports = isToday && due.length > 0 && due.every((r) => r.p.checkIn && r.p.report)
  // Celebrate once a day on this device: the whole team in on time, then every report in.
  useEffect(() => {
    if (allReports && firstToday('team-reports')) confetti(160)
    else if (allIn && firstToday('team-in')) confetti(160)
  }, [allIn, allReports])
  const teamMinutes = rows.reduce((n, r) => n + (r.p.checkIn ? r.minutes : 0), 0)

  return (
    <>
      {adding && <AddEmployeeDialog onAdded={res.reload} onClose={() => setAdding(false)} office={d ? { start: d.settings.startTime, end: d.settings.endTime ?? '' } : undefined} />}
      <div className="tm-bar">
        <div className="tm-date">
          <button className="icon-btn" onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day">
            ‹
          </button>
          <label className="tm-day">
            <strong>{isToday ? 'Today' : longDay(date).split(',')[0]}</strong>
            <span>{longDay(date).split(', ').slice(1).join(', ')}</span>
            <input type="date" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value || todayIst())} aria-label="Pick a day" />
          </label>
          <button className="icon-btn" onClick={() => setDate(shiftDay(date, 1))} disabled={isToday} aria-label="Next day">
            ›
          </button>
          {!isToday && (
            <button className="mini-btn" onClick={() => setDate(todayIst())}>
              Back to today
            </button>
          )}
        </div>
        <div className="tm-actions">
          <button className="btn ghost small" onClick={res.reload}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
          <button className="btn small" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            + Add employee
          </button>
        </div>
      </div>
      {res.error && !d ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : !d ? (
        <SkeletonList count={3} />
      ) : d.people.length === 0 ? (
        <p className="empty">No team members yet. Use “+ Add employee” to add someone; they log in with their mobile number.</p>
      ) : (
        <>
          <div className="tm-kpis">
            <div className="tm-kpi tm-kpi-main">
              <span>Present</span>
              <b>
                <Count n={present} />
                <small>/{total}</small>
              </b>
              <i className="tm-meter">
                <i style={{ width: `${total ? (present / total) * 100 : 0}%` }} />
              </i>
            </div>
            <div className="tm-kpi">
              <span>On time</span>
              <b>
                <Count n={present - d.summary.late} />
              </b>
            </div>
            <div className={`tm-kpi ${d.summary.late ? 'warn' : ''}`}>
              <span>Late</span>
              <b>
                <Count n={d.summary.late} />
              </b>
            </div>
            <div className="tm-kpi">
              <span>On leave</span>
              <b>
                <Count n={d.summary.onLeave ?? 0} />
              </b>
            </div>
            <div className="tm-kpi">
              <span>Reports</span>
              <b>
                <Count n={d.summary.reports} />
                <small>/{present || total}</small>
              </b>
            </div>
            <div className="tm-kpi">
              <span>Team hours</span>
              <b>
                <Count n={teamMinutes} fmt={hm} />
              </b>
            </div>
          </div>

          {(located.length > 0 || (d?.settings.offices ?? []).length > 0) && (
            <section className={`fm-panel ${mapOpen ? 'open' : ''}`}>
              <div className="fm-head">
                <div>
                  <b>Where the team checked in</b>
                  <small>
                    {located.length} of {present} shared a location
                    {located.some((r) => r.p.inPlace && !r.p.inPlace.office && r.p.inPlace.meters != null) ? ` · ${located.filter((r) => r.p.inPlace && !r.p.inPlace.office && r.p.inPlace.meters != null).length} away from office` : ''}
                  </small>
                </div>
                <button className={`btn small ${mapOpen ? 'ghost' : ''}`} onClick={() => setMapOpen((o) => !o)} aria-expanded={mapOpen}>
                  {mapOpen ? 'Hide map' : '🗺 Show map'}
                </button>
              </div>
              {mapOpen && (
                <>
                  <Suspense fallback={<div className="fm-map fm-loading">Loading map…</div>}>
                    <FieldMap
                      people={located.map((r) => ({ id: r.p.id, name: r.p.name, photo: r.p.photo ?? undefined, checkIn: r.p.checkIn, checkOut: r.p.checkOut, late: r.p.late, mode: r.p.mode, inPlace: r.p.inPlace, outPlace: r.p.outPlace }))}
                      offices={d?.settings.offices ?? []}
                    />
                  </Suspense>
                  <div className="fm-legend">
                    <span>
                      <i className="ok" /> On time
                    </span>
                    <span>
                      <i className="late" /> Late
                    </span>
                    <span>
                      <i className="out" /> Check-out
                    </span>
                    <span>
                      <i className="office" /> Office area
                    </span>
                  </div>
                  {unlocated.length > 0 && <p className="meta fm-none">No location shared: {unlocated.map((r) => r.p.name.split(' ')[0]).join(', ')}</p>}
                </>
              )}
            </section>
          )}
          {(allIn || allReports) && (
            <div className="tm-cele" role="status">
              <span aria-hidden="true">{allReports ? '🏆' : '🎉'}</span>
              <div>
                <b>{allReports ? 'All reports are in' : 'Everyone is in, on time'}</b>
                <small>{allReports ? `${due.length} of ${due.length} people sent today’s report.` : `${due.length} of ${due.length} checked in, nobody late.`}</small>
              </div>
            </div>
          )}
          <div className="tm-filters chips" role="tablist" aria-label="Show">
            {(
              [
                ['all', 'Everyone', rows.length],
                ['working', 'Working now', count.working],
                ['missing', 'Not in', count.missing],
                ['late', 'Late', count.late],
                ['pending', 'Report pending', count.pending],
              ] as [Filter, string, number][]
            ).map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
                {label} <span className="tm-n">{n}</span>
              </button>
            ))}
          </div>

          <p className="tm-legend" aria-hidden="true">
            <i className="l-shift" /> Shift <i className="l-work" /> Worked <i className="l-late" /> Late start {isToday && <><i className="l-now" /> Now</>}
          </p>

          {shown.length === 0 && <p className="empty">Nobody here.</p>}
          <div className="tm-list">
            {shown.map(({ p, start, end, inAt, outAt, minutes, st }, i) => (
              <article key={p.id} className={`tm-row ${st.tone}`} style={{ '--i': Math.min(i, 12) } as CSSProperties}>
                <div className="tm-who">
                  <PersonAvatar name={p.name} photo={p.photo} avatar={p.avatar} size={46} />
                  <div>
                    <strong>{p.name}</strong>
                    <span>{p.title || 'Team member'}</span>
                  </div>
                </div>
                <div className="tm-mid">
                  <ShiftBar from={from} to={to} start={start} end={end} inAt={inAt} outAt={outAt} now={isToday ? now : null} grace={grace} />
                  <dl className="tm-facts">
                    <div>
                      <dt>Shift</dt>
                      <dd>
                        {p.start ?? d.settings.startTime}–{p.end ?? d.settings.endTime ?? '–'}
                      </dd>
                    </div>
                    <div>
                      <dt>In</dt>
                      <dd>
                        {clock(p.checkIn)}
                        {p.late && inAt !== null && <em className="tm-late">+{hm(inAt - start).replace('0h ', '')}</em>}
                      </dd>
                    </div>
                    <div>
                      <dt>Out</dt>
                      <dd>{clock(p.checkOut)}</dd>
                    </div>
                    <div>
                      <dt>Hours</dt>
                      <dd>{p.checkIn ? hm(minutes) : '–'}</dd>
                    </div>
                    {p.mode && (
                      <div>
                        <dt>Mode</dt>
                        <dd>{MODE_LABEL[p.mode] ?? p.mode}</dd>
                      </div>
                    )}
                  </dl>
                  {(p.checkIn || p.tasks?.open || p.note) && (
                    <div className="tm-tags">
                      {p.checkIn && <PlaceTag p={p.inPlace} missing="No location at check-in" />}
                      {p.checkOut && <PlaceTag p={p.outPlace} missing="No location at check-out" />}
                      {p.tasks && (p.tasks.done.length > 0 || p.tasks.open > 0) && (
                        <span className={`tm-tag ${p.tasks.overdue ? 'warn' : ''}`}>
                          ✓ {p.tasks.done.length} task{p.tasks.done.length === 1 ? '' : 's'} done · {p.tasks.open} open{p.tasks.overdue ? ` · ${p.tasks.overdue} overdue` : ''}
                        </span>
                      )}
                      {p.note && <span className="tm-tag">“{p.note}”</span>}
                    </div>
                  )}
                </div>
                <div className="tm-side">
                  {p.checkIn && (
                    <RowMenu
                      title={p.name}
                      items={[
                        ...(p.checkOut ? [{ label: 'Undo check-out', onClick: () => void resetAtt(p.id, p.name, 'checkout') }] : []),
                        { label: 'Reset attendance for this day', danger: true, onClick: () => void resetAtt(p.id, p.name, 'all') },
                      ]}
                    />
                  )}
                  <span className={`tm-pill ${st.tone}`}>{st.label}</span>
                  {p.checkIn && <span className={`tm-rep ${p.report ? 'ok' : ''}`}>{p.report ? `Report ✓ ${clock(p.report.submittedAt)}` : 'Report pending'}</span>}
                </div>
                {p.report && (
                  <details className="tm-report">
                    <summary>
                      <b>Report</b> <span>{p.report.done.replace(/\s+/g, ' ').slice(0, 120)}{p.report.done.length > 120 ? '…' : ''}</span>
                    </summary>
                    <div className="tm-report-body">
                      <p>
                        <b>Worked on</b>
                        {p.report.done}
                      </p>
                      {p.report.plan && (
                        <p>
                          <b>Tomorrow</b>
                          {p.report.plan}
                        </p>
                      )}
                      {p.report.blockers && (
                        <p className="blocker">
                          <b>Blocked by</b>
                          {p.report.blockers}
                        </p>
                      )}
                      {p.report.links && (
                        <p className="links">
                          {p.report.links
                            .split(/\s+/)
                            .filter((l) => /^https?:\/\//.test(l))
                            .map((l) => (
                              <a key={l} href={l} target="_blank" rel="noopener noreferrer">
                                {l.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}
                              </a>
                            ))}
                        </p>
                      )}
                      {p.tasks && p.tasks.done.length > 0 && <p className="tm-done">✓ {p.tasks.done.join(' · ')}</p>}
                    </div>
                  </details>
                )}
                {p.activity.length > 0 && (
                  <ul className="tm-activity">
                    {p.activity.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      <TeamSettingsPanel />
    </>
  )
}

interface PersonTime {
  start?: string
  end?: string
  weekOff?: number[]
}
interface FullSettings {
  startTime: string
  endTime: string
  graceMin: number
  reminderTime: string
  weekOff: number[]
  people: Record<string, PersonTime>
  notifyCheckIn: boolean
  notifyCheckOut: boolean
  managerSummary: boolean
  ownerLive: boolean
  offices?: Office[]
  requireLocation?: boolean
  reportEmailOn?: boolean
  reportEmail?: string
  reportEmailTime?: string
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Owner / full access: office default hours, each person's own hours, and which notifications go out. */
function TeamSettingsPanel() {
  const res = useAsync('studio:team-settings', (s) => studio<{ settings: FullSettings }>('team/settings', undefined, s))
  const staff = useAsync('studio:people', (s) => studio<{ people: { id: string; name: string }[] }>('people', undefined, s))
  const [f, setF] = useState<FullSettings | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (res.data) setF({ ...res.data.settings, people: { ...(res.data.settings.people ?? {}) } })
  }, [res.data])
  if (!f) return null
  const setPerson = (id: string, patch: Partial<PersonTime> | null) =>
    setF((cur) => {
      if (!cur) return cur
      const people = { ...cur.people }
      if (patch === null) delete people[id]
      else {
        const next = { ...(people[id] ?? {}), ...patch }
        for (const k of Object.keys(next) as (keyof PersonTime)[]) if (next[k] === undefined || next[k] === '') delete next[k]
        if (Object.keys(next).length) people[id] = next
        else delete people[id]
      }
      return { ...cur, people }
    })
  const save = async () => {
    setBusy(true)
    try {
      await studioPost('team/settings', f)
      toast('Office timings saved')
      res.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const toggle = (k: 'notifyCheckIn' | 'notifyCheckOut' | 'managerSummary' | 'ownerLive', label: string, hint: string) => (
    <label className="set-row toggle att-toggle">
      <span>
        {label}
        <small>{hint}</small>
      </span>
      <input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
    </label>
  )
  return (
    <>
      <Panel title="Office timings" note="The default for everyone. Used for the Late mark, reminders (IST) and working days in the monthly attendance.">
        <div className="form-grid att-grid">
          <label>
            Office starts
            <input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
          </label>
          <label>
            Office ends
            <input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
          </label>
          <label>
            Grace (minutes)
            <input type="number" min={0} max={120} value={f.graceMin} onChange={(e) => setF({ ...f, graceMin: Number(e.target.value) })} />
          </label>
          <label>
            Report reminder
            <input type="time" value={f.reminderTime} onChange={(e) => setF({ ...f, reminderTime: e.target.value })} />
          </label>
        </div>
        <div className="weekoff" role="group" aria-label="Weekly off days">
          <span>Weekly off:</span>
          {DAYS.map((d, i) => (
            <label key={d} className="auth-check">
              <input type="checkbox" checked={f.weekOff.includes(i)} onChange={(e) => setF({ ...f, weekOff: e.target.checked ? [...f.weekOff, i].sort() : f.weekOff.filter((x) => x !== i) })} /> {d}
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="Each person’s office time" note="Set a different time or weekly off for anyone. Leave it as “Office default” to use the times above.">
        {!staff.data ? (
          <SkeletonList count={2} />
        ) : staff.data.people.length === 0 ? (
          <p className="empty">No team members yet.</p>
        ) : (
          <ul className="att-people">
            {staff.data.people.map((p) => {
              const own = f.people[p.id]
              const off = own?.weekOff ?? f.weekOff
              return (
                <li key={p.id} className={own ? 'custom' : ''}>
                  <div className="att-person-head">
                    <strong>{p.name}</strong>
                    {own ? (
                      <button className="mini-btn" onClick={() => setPerson(p.id, null)}>
                        Use office default
                      </button>
                    ) : (
                      <span className="meta">Office default</span>
                    )}
                  </div>
                  <div className="att-person-times">
                    <label>
                      Starts
                      <input type="time" value={own?.start ?? f.startTime} onChange={(e) => setPerson(p.id, { start: e.target.value })} />
                    </label>
                    <label>
                      Ends
                      <input type="time" value={own?.end ?? f.endTime} onChange={(e) => setPerson(p.id, { end: e.target.value })} />
                    </label>
                    <div className="att-days" role="group" aria-label={`${p.name} weekly off`}>
                      {DAYS.map((d, i) => (
                        <button
                          key={d}
                          type="button"
                          className={`att-day ${off.includes(i) ? 'off' : ''}`}
                          aria-pressed={off.includes(i)}
                          title={off.includes(i) ? `${d}: weekly off` : `${d}: working`}
                          onClick={() => setPerson(p.id, { weekOff: off.includes(i) ? off.filter((x) => x !== i) : [...off, i].sort() })}
                        >
                          {d[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p className="meta">Highlighted days are weekly offs. Late = after their start time + {f.graceMin} min grace.</p>
      </Panel>

      <Panel title="Office location (check-in place)" note="Team check-ins show “At office” within this distance, or how far away they were. Location is read only at check-in and check-out.">
        {(f.offices ?? []).length === 0 && <p className="empty">No office set yet. Stand in the office and tap “Add this place as office”.</p>}
        <ul className="att-offices">
          {(f.offices ?? []).map((o, i) => (
            <li key={`${o.name}-${i}`}>
              <input
                value={o.name}
                onChange={(e) => setF({ ...f, offices: (f.offices ?? []).map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                aria-label="Office name"
                maxLength={40}
              />
              <label>
                Radius
                <select value={o.radius} onChange={(e) => setF({ ...f, offices: (f.offices ?? []).map((x, j) => (j === i ? { ...x, radius: Number(e.target.value) } : x)) })}>
                  {[50, 100, 150, 250, 500, 1000].map((m) => (
                    <option key={m} value={m}>
                      {m} m
                    </option>
                  ))}
                </select>
              </label>
              <a className="mini-btn" href={mapLink(o)} target="_blank" rel="noopener noreferrer">
                Map
              </a>
              <button className="mini-btn danger" onClick={() => setF({ ...f, offices: (f.offices ?? []).filter((_, j) => j !== i) })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="action-row">
          <button
            className="btn ghost small"
            disabled={(f.offices ?? []).length >= 5 || busy}
            onClick={async () => {
              setBusy(true)
              const p = await getSpot(15000)
              setBusy(false)
              if (!p) return toast('Could not get this phone’s location. Allow location and try again.')
              if (p.acc > 200) toast(`Location is rough (about ${Math.round(p.acc)} m). Try again near a window for better accuracy.`)
              setF({ ...f, offices: [...(f.offices ?? []), { name: (f.offices ?? []).length ? `Office ${(f.offices ?? []).length + 1}` : 'Office', lat: p.lat, lng: p.lng, radius: 150 }] })
              toast('Office added. Rename it if you like, then Save.')
            }}
          >
            📍 Add this place as office
          </button>
        </div>
        <label className="set-row toggle att-toggle">
          <span>
            Location needed to check in and out
            <small>If on, staff can’t check in or out with location switched off. If off, they can, and it shows “No location”.</small>
          </span>
          <input type="checkbox" checked={!!f.requireLocation} onChange={(e) => setF({ ...f, requireLocation: e.target.checked })} />
        </label>
      </Panel>

      <Panel title="Daily team report by email" note="Every evening: each person’s check-in and check-out time and place, hours, work report, tasks and leave. Not sent on days nobody worked.">
        <label className="set-row toggle att-toggle">
          <span>
            Send the daily team report
            <small>Through the newsletter’s email connection (Brevo), from desk@realtynmore.com.</small>
          </span>
          <input type="checkbox" checked={f.reportEmailOn ?? true} onChange={(e) => setF({ ...f, reportEmailOn: e.target.checked })} />
        </label>
        <div className="form-grid att-grid">
          <label>
            Send to
            <input type="email" value={f.reportEmail ?? 'palash@realtynmore.com'} onChange={(e) => setF({ ...f, reportEmail: e.target.value })} />
          </label>
          <label>
            Time (IST)
            <input type="time" value={f.reportEmailTime ?? '19:30'} onChange={(e) => setF({ ...f, reportEmailTime: e.target.value })} />
          </label>
        </div>
        <button
          className="btn ghost small"
          onClick={async () => {
            try {
              const r = await studioPost<{ result: string }>('team/email-now', {})
              toast(r.result)
            } catch (e) {
              toast((e as Error).message)
            }
          }}
        >
          Send today’s report now
        </button>
        <MonthlyReport />
      </Panel>

      <Panel title="Attendance notifications" note="Sent to phones where “Turn on reminders” is switched on (team) and owner alerts are on (owner).">
        {toggle('notifyCheckIn', 'Check-in reminder', `To anyone not checked in ${f.graceMin} min after their start time (not on weekly off or approved leave).`)}
        {toggle('notifyCheckOut', 'Check-out reminder', 'To anyone still checked in 30 min after their end time, with a nudge to add the daily report.')}
        {toggle('managerSummary', 'Morning attendance summary to owner', 'Once a day, 15 min after office start + grace: who is in, late, not in yet and on leave.')}
        {toggle('ownerLive', 'Live alert for every check-in and check-out', 'A notification to the owner each time someone checks in or out. Can be a lot of notifications.')}
      </Panel>

      <div className="action-row att-save">
        <button className="btn" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save timings and notifications'}
        </button>
        <button
          className="btn ghost small"
          onClick={async () => {
            try {
              const r = await studioPost<{ result: string }>('team/remind-now', {})
              toast(r.result)
            } catch (e) {
              toast((e as Error).message)
            }
          }}
        >
          Send report reminders now
        </button>
      </div>
    </>
  )
}

/* ---------- owner: monthly attendance ---------- */
interface Month {
  month: string
  settings: { startTime: string; graceMin: number }
  rows: {
    id: string
    name: string
    present: number
    late: number
    reports: number
    minutes: number
    avgCheckIn: string | null
    workingDays?: number
    leave?: number
    leaveByKind?: Record<string, number>
    absent?: number
    days: Record<string, { in: string | null; out: string | null; late: boolean; report: boolean; leave?: string }>
  }[]
}
const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`

export function monthCsv(m: Month): string {
  const [y, mo] = m.month.split('-').map(Number)
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const dates = Array.from({ length: days }, (_, i) => `${m.month}-${String(i + 1).padStart(2, '0')}`)
  const head = ['Name', 'Working days', 'Days present', 'Leave days', 'Leave by type', 'Absent days', 'Late days', 'Reports', 'Total hours', 'Avg check-in', ...dates.map((d) => d.slice(8))]
  const lines = m.rows.map((r) => [
    r.name,
    r.workingDays ?? '',
    r.present,
    r.leave ?? 0,
    Object.entries(r.leaveByKind ?? {})
      .map(([k, v]) => `${k} ${v}`)
      .join('; '),
    r.absent ?? '',
    r.late,
    r.reports,
    (r.minutes / 60).toFixed(1),
    r.avgCheckIn ?? '',
    ...dates.map((d) => {
      const x = r.days[d]
      if (!x) return ''
      if (x.leave && !x.in) return `Leave: ${x.leave}`
      return `${x.in ?? ''}-${x.out ?? ''}${x.late ? ' L' : ''}${x.leave ? ` + ${x.leave}` : ''}`
    }),
  ])
  return [head, ...lines].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/** Monthly report (sent on the 1st at 9 AM IST to the same address): preview or send now. */
function MonthlyReport() {
  const last = (() => {
    const d = new Date(Date.now() + 5.5 * 3600000)
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() - 1)
    return d.toISOString().slice(0, 7)
  })()
  const [month, setMonth] = useState(last)
  const [busy, setBusy] = useState(false)
  const preview = async () => {
    setBusy(true)
    try {
      const r = await studio<{ html: string }>(`team/month-email?month=${month}`)
      const w = window.open('', '_blank')
      if (w) {
        w.document.open()
        w.document.write(r.html)
        w.document.close()
      } else toast('Allow pop-ups to see the preview.')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const send = async () => {
    if (!window.confirm(`Send the ${month} monthly report by email now?`)) return
    setBusy(true)
    try {
      toast((await studioPost<{ result: string }>('team/month-email-now', { month })).result)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="month-report">
      <b>Monthly report</b>
      <small>Full month in detail: attendance, hours, reports, tasks, leave, website, YouTube and the app. Goes by itself on the 1st at 9 AM.</small>
      <div className="action-row">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        <button className="btn ghost small" disabled={busy} onClick={() => void preview()}>
          Preview
        </button>
        <button className="btn ghost small" disabled={busy} onClick={() => void send()}>
          Send now
        </button>
      </div>
    </div>
  )
}

export function AttendanceTab() {
  const [month, setMonth] = useState(todayIst().slice(0, 7))
  const res = useAsync(`studio:month:${month}`, (s) => studio<Month>(`team/month?month=${month}`, undefined, s))
  const download = () => {
    if (!res.data) return
    const blob = new Blob(['﻿' + monthCsv(res.data)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `RM-attendance-${res.data.month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <>
      <div className="team-bar">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value || todayIst().slice(0, 7))} aria-label="Month" />
        <button className="btn small" onClick={download} disabled={!res.data?.rows.length}>
          <Icon name="download" size={16} /> Download Excel (CSV)
        </button>
      </div>
      <Panel title="Monthly attendance" note="For salary: working days exclude weekly offs; absent = working days with no check-in and no approved leave (a half-day leave counts 0.5). Hours count days with both check-in and check-out.">
        {res.error && !res.data ? (
          <ErrorState error={res.error} onRetry={res.reload} />
        ) : !res.data ? (
          <SkeletonList count={3} />
        ) : res.data.rows.length === 0 ? (
          <p className="empty">No team members yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="score-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Working days</th>
                  <th>Present</th>
                  <th>Leave</th>
                  <th>Absent</th>
                  <th>Late</th>
                  <th>Reports</th>
                  <th>Hours</th>
                  <th>Avg in</th>
                </tr>
              </thead>
              <tbody>
                {res.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.workingDays ?? '–'}</td>
                    <td>{r.present}</td>
                    <td title={Object.entries(r.leaveByKind ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ')}>{r.leave ?? 0}</td>
                    <td className={r.absent ? 'late-cell' : ''}>{r.absent ?? '–'}</td>
                    <td className={r.late ? 'late-cell' : ''}>{r.late}</td>
                    <td>{r.reports}</td>
                    <td>{(r.minutes / 60).toFixed(1)}</td>
                    <td>{r.avgCheckIn ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}
