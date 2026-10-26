// Tasks and leave in the Content Studio.
//   Tasks: the owner or full-access staff assign work with a due date; each person sees their own
//   list (also on My day), marks it done with an optional note.
//   Leave: staff request leave; the owner or full-access staff approve or decline it.
import { useMemo, useState, type FormEvent } from 'react'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDate, formatDateTime } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { hasFullAccess, ownerRole, studio, studioPost } from '../lib/owner.ts'
import { Panel } from './StudioTools.tsx'

export interface Task {
  id: number
  title: string
  details: string
  assignee_id: string
  assignee_name: string
  due: string | null
  priority: 'normal' | 'high'
  status: 'open' | 'done' | 'cancelled'
  created_by: string
  created_at: string
  done_at: string | null
  done_note: string | null
}
interface Leave {
  id: number
  person_id: string
  name: string
  kind: string
  from_day: string
  to_day: string
  half: number
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

export const LEAVE_KINDS: Record<string, string> = { casual: 'Casual leave', sick: 'Sick leave', earned: 'Earned / paid leave', unpaid: 'Unpaid leave', comp: 'Comp off' }
const STATUS: Record<Leave['status'], string> = { pending: 'Waiting', approved: 'Approved', rejected: 'Declined', cancelled: 'Cancelled' }
const todayIst = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
const dayLabel = (d: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00Z`))
const range = (l: Pick<Leave, 'from_day' | 'to_day' | 'half'>) => (l.from_day === l.to_day ? `${dayLabel(l.from_day)}${l.half ? ' (half day)' : ''}` : `${dayLabel(l.from_day)} – ${dayLabel(l.to_day)}`)

function due(t: Task, today: string) {
  if (t.status !== 'open' || !t.due) return t.due ? `Due ${dayLabel(t.due)}` : 'No due date'
  if (t.due < today) return 'Overdue'
  if (t.due === today) return 'Due today'
  return `Due ${dayLabel(t.due)}`
}

/** One task row: status, due date, and the buttons this person may use. */
function TaskRow({ t, today, showWho, onChange }: { t: Task; today: string; showWho: boolean; onChange: () => void }) {
  const [note, setNote] = useState('')
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const full = hasFullAccess()
  const act = async (status: 'done' | 'open' | 'cancelled') => {
    setBusy(true)
    try {
      await studioPost('tasks/update', { id: t.id, status, note })
      toast(status === 'done' ? 'Marked done' : status === 'open' ? 'Reopened' : 'Task cancelled')
      setClosing(false)
      onChange()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const overdue = t.status === 'open' && !!t.due && t.due < today
  return (
    <li className={`task ${t.status} ${overdue ? 'overdue' : ''}`}>
      <div className="task-main">
        <div className="task-head">
          <strong>{t.title}</strong>
          {t.priority === 'high' && t.status === 'open' && <span className="task-tag high">High</span>}
          <span className={`task-tag ${t.status === 'done' ? 'done' : overdue ? 'late' : ''}`}>{t.status === 'done' ? 'Done' : t.status === 'cancelled' ? 'Cancelled' : due(t, today)}</span>
        </div>
        {t.details && <p className="task-details">{t.details}</p>}
        <span className="meta">
          {showWho && <b>{t.assignee_name} · </b>}
          Assigned by {t.created_by} · {formatDate(t.created_at)}
          {t.done_at && ` · done ${formatDateTime(t.done_at)}`}
        </span>
        {t.done_note && <p className="task-note">“{t.done_note}”</p>}
        {closing && (
          <div className="task-close">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done (optional), e.g. link or result" aria-label="Done note" maxLength={300} />
            <button className="btn small" disabled={busy} onClick={() => act('done')}>
              Mark done
            </button>
          </div>
        )}
      </div>
      <div className="task-btns">
        {t.status === 'open' && !closing && (
          <button className="mini-btn" disabled={busy} onClick={() => setClosing(true)}>
            Done
          </button>
        )}
        {t.status !== 'open' && (
          <button className="mini-btn" disabled={busy} onClick={() => act('open')}>
            Reopen
          </button>
        )}
        {full && t.status === 'open' && (
          <button className="mini-btn danger" disabled={busy} onClick={() => act('cancelled')}>
            Cancel
          </button>
        )}
      </div>
    </li>
  )
}

/** "Tasks for you" on My day: open tasks, overdue first. */
export function MyTasksPanel() {
  const res = useAsync('studio:tasks:mine', (s) => studio<{ today: string; tasks: Task[] }>('tasks?scope=mine', undefined, s))
  const open = (res.data?.tasks ?? []).filter((t) => t.status === 'open')
  if (!res.data || open.length === 0) return null
  return (
    <Panel title={`Tasks for you (${open.length})`} note="Mark each one done when finished; it shows in your day for the owner.">
      <ul className="task-list">
        {open.map((t) => (
          <TaskRow key={t.id} t={t} today={res.data!.today} showWho={false} onChange={res.reload} />
        ))}
      </ul>
    </Panel>
  )
}

export function TasksTab() {
  const full = hasFullAccess()
  const isStaff = ownerRole()?.role !== 'owner'
  const mine = useAsync(isStaff ? 'studio:tasks:mine' : null, (s) => studio<{ today: string; tasks: Task[] }>('tasks?scope=mine', undefined, s))
  const all = useAsync(full ? 'studio:tasks:all' : null, (s) => studio<{ today: string; tasks: Task[] }>('tasks?scope=all', undefined, s))
  const people = useAsync(full ? 'studio:people' : null, (s) => studio<{ people: { id: string; name: string }[] }>('people', undefined, s))
  const [f, setF] = useState({ title: '', details: '', assigneeId: '', due: '', priority: 'normal' })
  const [busy, setBusy] = useState(false)
  const [who, setWho] = useState('')
  const [show, setShow] = useState<'open' | 'done' | 'all'>('open')
  const reload = () => {
    mine.reload()
    all.reload()
  }
  const assign = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await studioPost('tasks', f)
      const name = people.data?.people.find((p) => p.id === f.assigneeId)?.name
      toast(`Task given to ${name ?? 'them'}`)
      setF({ title: '', details: '', assigneeId: f.assigneeId, due: '', priority: 'normal' })
      reload()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const team = useMemo(() => {
    const list = all.data?.tasks ?? []
    return list.filter((t) => (!who || t.assignee_id === who) && (show === 'all' || (show === 'open' ? t.status === 'open' : t.status === 'done')))
  }, [all.data, who, show])
  const counts = useMemo(() => {
    const list = all.data?.tasks ?? []
    const today = all.data?.today ?? todayIst()
    return { open: list.filter((t) => t.status === 'open').length, overdue: list.filter((t) => t.status === 'open' && t.due && t.due < today).length, doneToday: list.filter((t) => t.done_at && t.done_at.slice(0, 10) === today).length }
  }, [all.data])

  return (
    <>
      {full && (
        <Panel title="Give a task" note="The person sees it on their My day and in Tasks. You see progress here and in Team today.">
          <form className="form-grid task-form" onSubmit={assign}>
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What needs to be done, e.g. Interview script for DLF CEO" aria-label="Task" maxLength={140} required />
            <textarea value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="Details (optional): links, notes" aria-label="Details" rows={2} maxLength={1000} />
            <select className="wide-select" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })} aria-label="Who" required>
              <option value="">Who should do it?</option>
              {(people.data?.people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="task-due">
              Due date
              <input type="date" value={f.due} min={todayIst()} onChange={(e) => setF({ ...f, due: e.target.value })} />
            </label>
            <label className="auth-check">
              <input type="checkbox" checked={f.priority === 'high'} onChange={(e) => setF({ ...f, priority: e.target.checked ? 'high' : 'normal' })} /> High priority
            </label>
          </form>
          <div className="action-row">
            <button className="btn" disabled={busy || f.title.trim().length < 3 || !f.assigneeId} onClick={assign}>
              {busy ? 'Saving…' : 'Give task'}
            </button>
          </div>
        </Panel>
      )}

      {isStaff && (
        <Panel title="My tasks">
          {mine.error && !mine.data ? (
            <ErrorState error={mine.error} onRetry={mine.reload} />
          ) : !mine.data ? (
            <SkeletonList count={2} />
          ) : mine.data.tasks.length === 0 ? (
            <p className="empty">No tasks for you right now.</p>
          ) : (
            <ul className="task-list">
              {mine.data.tasks.map((t) => (
                <TaskRow key={t.id} t={t} today={mine.data!.today} showWho={false} onChange={reload} />
              ))}
            </ul>
          )}
        </Panel>
      )}

      {full && (
        <Panel title="Team tasks" note={`${counts.open} open · ${counts.overdue} overdue · ${counts.doneToday} done today`}>
          <div className="team-bar">
            <select className="wide-select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person">
              <option value="">Everyone</option>
              {(people.data?.people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="segmented small" role="radiogroup" aria-label="Show">
              {(['open', 'done', 'all'] as const).map((k) => (
                <button key={k} role="radio" aria-checked={show === k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>
                  {k === 'open' ? 'Open' : k === 'done' ? 'Done' : 'All'}
                </button>
              ))}
            </div>
          </div>
          {all.error && !all.data ? (
            <ErrorState error={all.error} onRetry={all.reload} />
          ) : !all.data ? (
            <SkeletonList count={3} />
          ) : team.length === 0 ? (
            <p className="empty">Nothing here.</p>
          ) : (
            <ul className="task-list">
              {team.map((t) => (
                <TaskRow key={t.id} t={t} today={all.data!.today} showWho onChange={reload} />
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  )
}

/* ---------- leave ---------- */

function LeaveRow({ l, children }: { l: Leave; children?: React.ReactNode }) {
  return (
    <li className={`leave ${l.status}`}>
      <div className="task-main">
        <div className="task-head">
          <strong>{l.name}</strong>
          <span className={`task-tag ${l.status === 'approved' ? 'done' : l.status === 'rejected' ? 'late' : ''}`}>{STATUS[l.status]}</span>
        </div>
        <span>
          <b>{LEAVE_KINDS[l.kind] ?? l.kind}</b> · {range(l)}
        </span>
        <p className="task-details">{l.reason}</p>
        <span className="meta">
          Asked {formatDateTime(l.created_at)}
          {l.decided_by && ` · ${STATUS[l.status].toLowerCase()} by ${l.decided_by}`}
          {l.decision_note && ` · “${l.decision_note}”`}
        </span>
      </div>
      {children && <div className="task-btns">{children}</div>}
    </li>
  )
}

export function LeaveTab() {
  const full = hasFullAccess()
  const isStaff = ownerRole()?.role !== 'owner'
  const mine = useAsync(isStaff ? 'studio:leaves:mine' : null, (s) => studio<{ leaves: Leave[] }>('me/leaves', undefined, s))
  const [month, setMonth] = useState(todayIst().slice(0, 7))
  const team = useAsync(full ? `studio:leaves:${month}` : null, (s) => studio<{ leaves: Leave[] }>(`leaves?month=${month}`, undefined, s))
  const [f, setF] = useState({ kind: 'casual', from: '', to: '', half: false, reason: '' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Record<number, string>>({})

  const request = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await studioPost('me/leave', { ...f, to: f.to || f.from })
      toast('Leave request sent')
      setF({ kind: 'casual', from: '', to: '', half: false, reason: '' })
      mine.reload()
      team.reload()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const cancel = async (id: number) => {
    try {
      await studioPost('me/leave/cancel', { id })
      toast('Leave cancelled')
      mine.reload()
      team.reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }
  const decide = async (l: Leave, status: 'approved' | 'rejected') => {
    try {
      await studioPost('leaves/decide', { id: l.id, status, note: note[l.id] ?? '' })
      toast(status === 'approved' ? `${l.name}'s leave approved` : `${l.name}'s leave declined`)
      team.reload()
      mine.reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }
  // This year's approved leave by type, for the person's own record.
  const used = useMemo(() => {
    const year = todayIst().slice(0, 4)
    const out: Record<string, number> = {}
    for (const l of mine.data?.leaves ?? []) {
      if (l.status !== 'approved' || !l.from_day.startsWith(year)) continue
      const days = l.half ? 0.5 : Math.round((Date.parse(`${l.to_day}T00:00:00Z`) - Date.parse(`${l.from_day}T00:00:00Z`)) / 86400000) + 1
      out[LEAVE_KINDS[l.kind] ?? l.kind] = (out[LEAVE_KINDS[l.kind] ?? l.kind] ?? 0) + days
    }
    return out
  }, [mine.data])
  const pending = (team.data?.leaves ?? []).filter((l) => l.status === 'pending')
  const rest = (team.data?.leaves ?? []).filter((l) => l.status !== 'pending')

  return (
    <>
      {isStaff && (
        <Panel title="Ask for leave" note="Weekly offs are not counted as leave. The owner or a full-access person approves it.">
          <form className="form-grid task-form" onSubmit={request}>
            <select className="wide-select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Type of leave">
              {Object.entries(LEAVE_KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <label className="task-due">
              From
              <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} required />
            </label>
            <label className="task-due">
              To (leave empty for one day)
              <input type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value, half: false })} />
            </label>
            {(!f.to || f.to === f.from) && (
              <label className="auth-check">
                <input type="checkbox" checked={f.half} onChange={(e) => setF({ ...f, half: e.target.checked })} /> Half day
              </label>
            )}
            <textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Reason, e.g. family function in Lucknow" aria-label="Reason" rows={2} maxLength={400} required />
          </form>
          <div className="action-row">
            <button className="btn" disabled={busy || !f.from || f.reason.trim().length < 3} onClick={request}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </Panel>
      )}

      {isStaff && (
        <Panel title="My leave" note={Object.keys(used).length ? `Approved this year: ${Object.entries(used).map(([k, v]) => `${k} ${v}`).join(' · ')}` : undefined}>
          {mine.error && !mine.data ? (
            <ErrorState error={mine.error} onRetry={mine.reload} />
          ) : !mine.data ? (
            <SkeletonList count={2} />
          ) : mine.data.leaves.length === 0 ? (
            <p className="empty">No leave yet.</p>
          ) : (
            <ul className="task-list">
              {mine.data.leaves.map((l) => (
                <LeaveRow key={l.id} l={l}>
                  {(l.status === 'pending' || (l.status === 'approved' && l.from_day > todayIst())) && (
                    <button className="mini-btn danger" onClick={() => cancel(l.id)}>
                      Cancel
                    </button>
                  )}
                </LeaveRow>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {full && (
        <>
          <Panel title={`Leave requests${pending.length ? ` (${pending.length})` : ''}`} note="Approved leave shows in Team today and in the monthly attendance for salary.">
            {!team.data ? (
              <SkeletonList count={2} />
            ) : pending.length === 0 ? (
              <p className="empty">No requests waiting.</p>
            ) : (
              <ul className="task-list">
                {pending.map((l) => (
                  <LeaveRow key={l.id} l={l}>
                    <input className="leave-note" value={note[l.id] ?? ''} onChange={(e) => setNote({ ...note, [l.id]: e.target.value })} placeholder="Note (optional)" aria-label="Note" maxLength={300} />
                    <button className="mini-btn" onClick={() => decide(l, 'approved')}>
                      Approve
                    </button>
                    <button className="mini-btn danger" onClick={() => decide(l, 'rejected')}>
                      Decline
                    </button>
                  </LeaveRow>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Team leave by month">
            <div className="team-bar">
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value || todayIst().slice(0, 7))} aria-label="Month" />
            </div>
            {!team.data ? (
              <SkeletonList count={2} />
            ) : rest.length === 0 ? (
              <p className="empty">No leave in this month.</p>
            ) : (
              <ul className="task-list">
                {rest.map((l) => (
                  <LeaveRow key={l.id} l={l}>
                    {l.status === 'approved' && (
                      <button className="mini-btn danger" onClick={() => decide(l, 'rejected')}>
                        Withdraw approval
                      </button>
                    )}
                  </LeaveRow>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  )
}
