// Team attendance and daily work reports in the Content Studio.
// Employees: "My day" (check in/out, daily report). Owner: "Team today" and monthly "Attendance" with CSV export.
import { useEffect, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDate } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { studio, studioPost } from '../lib/owner.ts'
import { getSpot, mapLink } from '../lib/location.ts'
import { PersonAvatar } from '../components/PersonAvatar.tsx'
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
  return (
    <a className={`place-tag ${p.office ? 'in' : 'away'}`} href={mapLink(p)} target="_blank" rel="noopener noreferrer" title={`Accuracy about ${p.acc} m. Open in Google Maps`}>
      📍 {p.label}
    </a>
  )
}

/* ---------- employee: My day ---------- */
export function MyDayTab() {
  const res = useAsync('studio:myday', (s) => studio<Today>('me/today', undefined, s))
  const hist = useAsync('studio:myhistory', (s) => studio<{ days: { day: string; checkIn: string | null; checkOut: string | null; late: boolean; minutes: number; report: string | null }[] }>('me/history', undefined, s))
  const [mode, setMode] = useState('office')
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
      const r = await studioPost<{ ok?: boolean; error?: string }>(path, body)
      if (r.ok === false) throw new Error(r.error)
      toast(done)
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
  const live = a?.check_in && !a.check_out ? Math.round((Date.now() - Date.parse(a.check_in)) / 60000) : d.minutes

  return (
    <>
      <section className="day-card">
        <div className="day-head">
          <div>
            <span className="owner-badge">{formatDate(`${d.day}T06:00:00Z`)}</span>
            <h2>Hi {d.name}</h2>
            <p className="panel-note">
              Your office time {d.settings.startTime}{d.settings.endTime ? ` to ${d.settings.endTime}` : ''} (grace {d.settings.graceMin} min). Report reminder at {d.settings.reminderTime}.
            </p>
          </div>
          <div className="day-timer">
            <b>{a?.check_in ? `${Math.floor(live / 60)}h ${String(live % 60).padStart(2, '0')}m` : '–'}</b>
            <span>{a?.check_in ? (a.check_out ? 'worked today' : 'working') : 'not checked in'}</span>
          </div>
        </div>

        {!a?.check_in ? (
          <div className="checkin-box">
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
            <p className="meta loc-note">📍 Your location is saved only at the moment you check in and check out, never in between. Only the owner sees it.</p>
          </div>
        ) : (
          <div className="att-row">
            <div>
              <span className="meta">Check in</span>
              <b>
                {clock(a.check_in)} {d.late && <em className="late">Late</em>}
              </b>
              <span className="meta">{MODE_LABEL[a.mode ?? 'office']}</span>
              <PlaceTag p={d.place?.in} missing="Location not shared" />
            </div>
            <div>
              <span className="meta">Check out</span>
              <b>{clock(a.check_out)}</b>
              {a.check_out && <PlaceTag p={d.place?.out} missing="Location not shared" />}
            </div>
            {!a.check_out && (
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  const loc = await getSpot()
                  setBusy(false)
                  if (!loc && d.settings.requireLocation) return toast('Please allow location for this app, then check out again.')
                  void act('me/checkout', { loc }, d.report ? 'Checked out. Have a good evening!' : 'Checked out. Please add your report.')
                }}
              >
                <Icon name="clock" size={18} /> Check out
              </button>
            )}
          </div>
        )}
      </section>

      <MyTasksPanel />
      <Panel title={d.report ? 'Today’s report (saved, you can edit)' : 'Today’s work report'} note="Your report goes only to the owner.">
        <form className="form-grid one" onSubmit={sendReport}>
          <label>
            What did you work on today?
            <textarea rows={4} value={form.done} onChange={(e) => setForm({ ...form, done: e.target.value })} placeholder="e.g. Wrote 3 RERA stories, edited the DLF interview, posted 2 reels" />
          </label>
          <label>
            Plan for tomorrow <small>optional</small>
            <textarea rows={2} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} />
          </label>
          <label>
            Anything blocking you? <small>optional</small>
            <input value={form.blockers} onChange={(e) => setForm({ ...form, blockers: e.target.value })} />
          </label>
          <label>
            Links to your work <small>optional</small>
            <input value={form.links} onChange={(e) => setForm({ ...form, links: e.target.value })} placeholder="Story or video links, separated by spaces" />
          </label>
          <button className="btn" disabled={busy || form.done.trim().length < 3}>
            {d.report ? 'Update report' : 'Submit report'}
          </button>
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
  settings: { startTime: string; graceMin: number; reminderTime: string; weekOff?: number[] }
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
export function TeamTodayTab() {
  const [date, setDate] = useState(todayIst)
  const res = useAsync(`studio:teamday:${date}`, (s) => studio<TeamDay>(`team/day?date=${date}`, undefined, s))
  const d = res.data
  return (
    <>
      <div className="team-bar">
        <input type="date" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value || todayIst())} aria-label="Day" />
        <button className="mini-btn" onClick={() => setDate(todayIst())}>
          Today
        </button>
        <button className="mini-btn" onClick={res.reload}>
          <Icon name="refresh" size={13} /> Refresh
        </button>
      </div>
      {res.error && !d ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : !d ? (
        <SkeletonList count={3} />
      ) : d.people.length === 0 ? (
        <p className="empty">No team members yet. Create editor keys in the Team tab; each person checks in with their own key.</p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <b>
                {d.summary.present}/{d.summary.total}
              </b>
              <span>Checked in</span>
            </div>
            <div className={`kpi ${d.summary.late ? 'warn' : ''}`}>
              <b>{d.summary.late}</b>
              <span>Late (after {d.settings.startTime} + {d.settings.graceMin} min)</span>
            </div>
            <div className="kpi">
              <b>
                {d.summary.reports}/{d.summary.total}
              </b>
              <span>Reports</span>
            </div>
          </div>
          {d.people.map((p) => (
            <section key={p.id} className={`person ${p.checkIn ? '' : 'absent'} ${p.leave && !p.checkIn ? 'on-leave' : ''}`}>
              <div className="person-head">
                <PersonAvatar name={p.name} photo={p.photo} avatar={p.avatar} size={40} />
                <strong>
                  {p.name}
                  {p.title && <small className="person-title">{p.title}</small>}
                </strong>
                <span className={`status ${p.checkIn ? (p.checkOut ? 'out' : 'in') : p.leave ? 'leave' : 'none'}`}>
                  {p.checkIn ? (p.checkOut ? 'Checked out' : 'Working') : p.leave ? `On leave${p.leave.half ? ' (half day)' : ''}` : 'Not checked in'}
                </span>
              </div>
              {p.leave && <p className="panel-note">{p.leave.kind}{p.leave.half ? ', half day' : ''}</p>}
              {p.tasks && (p.tasks.done.length > 0 || p.tasks.open > 0) && (
                <p className="person-tasks">
                  <b>Tasks:</b> {p.tasks.done.length} done today · {p.tasks.open} open
                  {p.tasks.overdue > 0 && <em className="late">{p.tasks.overdue} overdue</em>}
                  {p.tasks.done.length > 0 && <span className="person-tasks-done">✓ {p.tasks.done.join(' · ')}</span>}
                </p>
              )}
              <div className="person-times">
                {p.start && (
                  <span className="meta">
                    Shift {p.start}–{p.end}
                  </span>
                )}
                <span>
                  In <b>{clock(p.checkIn)}</b> {p.late && <em className="late">Late</em>} {p.checkIn && <PlaceTag p={p.inPlace} />}
                </span>
                <span>
                  Out <b>{clock(p.checkOut)}</b> {p.checkOut && <PlaceTag p={p.outPlace} />}
                </span>
                <span>
                  Hours <b>{hours(p.minutes)}</b>
                </span>
                {p.mode && <span>{MODE_LABEL[p.mode] ?? p.mode}</span>}
              </div>
              {p.note && <p className="panel-note">Note: {p.note}</p>}
              {p.report ? (
                <div className="person-report">
                  <p>
                    <b>Worked on:</b> {p.report.done}
                  </p>
                  {p.report.plan && (
                    <p>
                      <b>Tomorrow:</b> {p.report.plan}
                    </p>
                  )}
                  {p.report.blockers && (
                    <p className="blocker">
                      <b>Blocked by:</b> {p.report.blockers}
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
                  <span className="meta">Submitted {clock(p.report.submittedAt)}</span>
                </div>
              ) : (
                <p className="empty">{p.checkIn ? 'No report yet.' : '—'}</p>
              )}
              {p.activity.length > 0 && (
                <ul className="activity">
                  {p.activity.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
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
