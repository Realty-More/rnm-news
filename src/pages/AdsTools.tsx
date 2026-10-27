// Ad sales tracker in the Content Studio (owner and full-access staff only).
//   Follow-ups due today, money owed and overdue, every deal with its stage and payments,
//   the advertiser list, and Excel (CSV) downloads. Amounts are rupees; GST is added on top.
import { useMemo, useState, type FormEvent } from 'react'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { useAsync } from '../lib/hooks.ts'
import { ownerRole, studio, studioPost } from '../lib/owner.ts'
import { Panel } from './StudioTools.tsx'

type Stage = 'lead' | 'proposal' | 'negotiating' | 'confirmed' | 'running' | 'completed' | 'lost'
interface Client {
  id: number
  name: string
  contact: string
  phone: string
  email: string
  city: string
  gstin: string
  notes: string
}
interface Deal {
  id: number
  client_id: number
  title: string
  medium: string
  period: string
  amount: number
  gst_pct: number
  stage: Stage
  handled_by: string
  next_date: string | null
  next_action: string
  invoice_no: string
  due_day: string | null
  notes: string
  created_at: string
  received: number
}
interface Payment {
  id: number
  deal_id: number
  day: string
  amount: number
  mode: string
  ref: string
  note: string
  by_name: string
}
interface Book {
  today: string
  clients: Client[]
  deals: Deal[]
  payments: Payment[]
}

export const STAGE_LABEL: Record<Stage, string> = {
  lead: 'Lead',
  proposal: 'Proposal sent',
  negotiating: 'Negotiating',
  confirmed: 'Confirmed',
  running: 'Running',
  completed: 'Completed',
  lost: 'Lost',
}
const STAGES = Object.keys(STAGE_LABEL) as Stage[]
const BOOKED: Stage[] = ['confirmed', 'running', 'completed']
const OPEN: Stage[] = ['lead', 'proposal', 'negotiating']
const MEDIUM: Record<string, string> = {
  magazine: 'Magazine ad',
  website: 'Website banner',
  sponsored: 'Sponsored story',
  video: 'Video / interview',
  event: 'Event sponsorship',
  social: 'Social media',
  other: 'Other',
}
const MODE: Record<string, string> = { bank: 'Bank transfer', upi: 'UPI', cheque: 'Cheque', cash: 'Cash', other: 'Other' }

/** ₹1,18,000 */
export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
/** ₹1.18 L / ₹2.5 Cr for the summary cards. */
export function inrShort(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 2).replace(/\.?0+$/, '')} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')} L`
  return inr(n)
}
export const totalWithGst = (d: Pick<Deal, 'amount' | 'gst_pct'>) => Math.round(d.amount * (1 + d.gst_pct / 100))
export const balanceOf = (d: Pick<Deal, 'amount' | 'gst_pct' | 'stage' | 'received'>) => (BOOKED.includes(d.stage) ? Math.max(0, totalWithGst(d) - d.received) : 0)
/** "2026-10-27" → "2026-27" (Indian financial year, April to March). */
export function fyOf(day: string): string {
  const y = Number(day.slice(0, 4))
  const start = Number(day.slice(5, 7)) >= 4 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}
const istDay = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600000).toISOString().slice(0, 10)
const dayLabel = (d: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T00:00:00Z`))
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const digits = (p: string) => p.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '')

/** Polite payment reminder for WhatsApp, ready to send. */
export function reminderText(d: Pick<Deal, 'title' | 'invoice_no' | 'due_day' | 'amount' | 'gst_pct' | 'stage' | 'received'>, contact: string, from: string): string {
  const due = balanceOf(d)
  return [
    `Dear ${contact || 'Sir/Madam'},`,
    `Greetings from Realty & More. This is a gentle reminder that ${inr(due)} is pending for "${d.title}"${d.invoice_no ? ` (invoice ${d.invoice_no})` : ''}${d.due_day ? `, due on ${dayLabel(d.due_day)}` : ''}.`,
    'Kindly arrange the payment at the earliest. Please ignore if already paid.',
    ['Regards,', from, 'Realty & More'].filter(Boolean).join('\n'),
  ].join('\n\n')
}

/** Booked (with GST) and received per month of a financial year, April to March. */
export function monthlyFy(deals: Deal[], payments: Payment[], fy: string): { month: string; label: string; booked: number; received: number }[] {
  const start = Number(fy.slice(0, 4))
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1
    const y = m >= 4 ? start : start + 1
    return `${y}-${String(m).padStart(2, '0')}`
  })
  return months.map((month) => ({
    month,
    label: new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`)),
    booked: deals.filter((d) => BOOKED.includes(d.stage) && istDay(d.created_at).startsWith(month)).reduce((s, d) => s + totalWithGst(d), 0),
    received: payments.filter((p) => p.day.startsWith(month)).reduce((s, p) => s + p.amount, 0),
  }))
}

/** Excel-friendly CSV of deals. */
export function dealsCsv(deals: Deal[], clients: Map<number, Client>): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Advertiser', 'Deal', 'Medium', 'Period', 'Stage', 'Amount (before GST)', 'GST %', 'Total with GST', 'Received', 'Balance', 'Invoice no', 'Payment due', 'Next follow-up', 'Handled by', 'Created']
  const rows = deals.map((d) => [
    clients.get(d.client_id)?.name ?? '',
    d.title,
    MEDIUM[d.medium] ?? d.medium,
    d.period,
    STAGE_LABEL[d.stage],
    d.amount,
    d.gst_pct,
    totalWithGst(d),
    d.received,
    balanceOf(d),
    d.invoice_no,
    d.due_day ?? '',
    d.next_date ?? '',
    d.handled_by,
    istDay(d.created_at),
  ])
  return '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
}

function download(name: string, csv: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

async function post(path: string, body: unknown, ok?: string): Promise<boolean> {
  try {
    await studioPost(`ads/${path}`, body)
    if (ok) toast(ok)
    return true
  } catch (e) {
    toast((e as Error).message)
    return false
  }
}

/* ---------- advertiser form ---------- */

const EMPTY_CLIENT = { name: '', contact: '', phone: '', email: '', city: '', gstin: '', notes: '' }

function ClientForm({ initial, onDone, onCancel }: { initial?: Client; onDone: (id: number) => void; onCancel: () => void }) {
  const [f, setF] = useState(initial ? { ...EMPTY_CLIENT, ...initial } : EMPTY_CLIENT)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof EMPTY_CLIENT) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await studioPost<{ id: number }>('ads/client', { ...f, id: initial?.id })
      toast(initial ? 'Advertiser saved' : `${f.name} added`)
      onDone(r.id)
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="form-grid ad-form" onSubmit={save}>
      <label className="ad-span">
        Company / advertiser
        <input value={f.name} onChange={set('name')} placeholder="e.g. Gaurs Group" maxLength={120} required />
      </label>
      <label>
        Contact person
        <input value={f.contact} onChange={set('contact')} placeholder="Name and designation" maxLength={80} />
      </label>
      <label>
        Phone
        <input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="Mobile number" maxLength={40} />
      </label>
      <label>
        Email
        <input value={f.email} onChange={set('email')} type="email" placeholder="name@company.com" maxLength={120} />
      </label>
      <label>
        City
        <input value={f.city} onChange={set('city')} placeholder="e.g. Noida" maxLength={60} />
      </label>
      <label>
        GSTIN <small>for invoices (optional)</small>
        <input value={f.gstin} onChange={set('gstin')} placeholder="15 characters" maxLength={15} />
      </label>
      <label className="ad-span">
        Notes
        <textarea value={f.notes} onChange={set('notes')} rows={2} placeholder="Brands, decision maker, preferences" maxLength={1000} />
      </label>
      <div className="action-row ad-span">
        <button className="btn" disabled={busy || f.name.trim().length < 2}>
          {busy ? 'Saving…' : initial ? 'Save advertiser' : 'Add advertiser'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/* ---------- deal form ---------- */

function DealForm({ book, initial, onDone, onCancel, onClientAdded }: { book: Book; initial?: Deal; onDone: () => void; onCancel: () => void; onClientAdded: () => void }) {
  const me = ownerRole()?.name ?? ''
  const [f, setF] = useState({
    clientId: initial ? String(initial.client_id) : '',
    title: initial?.title ?? '',
    medium: initial?.medium ?? 'magazine',
    period: initial?.period ?? '',
    amount: initial ? String(initial.amount) : '',
    gstPct: initial ? String(initial.gst_pct) : '18',
    stage: initial?.stage ?? 'lead',
    handledBy: initial?.handled_by ?? me,
    nextDate: initial?.next_date ?? addDays(book.today, 2),
    nextAction: initial?.next_action ?? '',
    invoiceNo: initial?.invoice_no ?? '',
    dueDay: initial?.due_day ?? '',
    notes: initial?.notes ?? '',
  })
  const [newClient, setNewClient] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const total = totalWithGst({ amount: Number(f.amount) || 0, gst_pct: Number(f.gstPct) })
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const ok = await post('deal', { ...f, id: initial?.id, amount: Number(f.amount), gstPct: Number(f.gstPct) }, initial ? 'Deal saved' : 'Deal added')
    setBusy(false)
    if (ok) onDone()
  }
  if (newClient)
    return (
      <>
        <p className="panel-note">New advertiser first; the deal form comes back after saving.</p>
        <ClientForm
          onCancel={() => setNewClient(false)}
          onDone={(id) => {
            setF({ ...f, clientId: String(id) })
            setNewClient(false)
            onClientAdded()
          }}
        />
      </>
    )
  return (
    <form className="form-grid ad-form" onSubmit={save}>
      <label className="ad-span">
        Advertiser
        <span className="ad-row">
          <select className="wide-select" value={f.clientId} onChange={set('clientId')} required>
            <option value="">Pick the advertiser</option>
            {book.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn ghost small" onClick={() => setNewClient(true)}>
            + New
          </button>
        </span>
      </label>
      <label className="ad-span">
        What is sold
        <input value={f.title} onChange={set('title')} placeholder="e.g. Full page ad + back cover" maxLength={140} required />
      </label>
      <label>
        Medium
        <select value={f.medium} onChange={set('medium')}>
          {Object.entries(MEDIUM).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        Issue / period
        <input value={f.period} onChange={set('period')} placeholder="e.g. Jan–Mar 2027 issue, or 1–31 Dec" maxLength={80} />
      </label>
      <label>
        Amount ₹ <small>before GST</small>
        <input value={f.amount} onChange={set('amount')} inputMode="numeric" placeholder="e.g. 150000" required />
      </label>
      <label>
        GST
        <select value={f.gstPct} onChange={set('gstPct')}>
          {[18, 12, 5, 28, 0].map((g) => (
            <option key={g} value={g}>
              {g}%
            </option>
          ))}
        </select>
      </label>
      <p className="ad-total ad-span">
        Total with GST: <b>{inr(total)}</b>
      </p>
      <label>
        Stage
        <select value={f.stage} onChange={set('stage')}>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Handled by
        <input value={f.handledBy} onChange={set('handledBy')} placeholder="Who is following up" maxLength={60} />
      </label>
      <label>
        Next follow-up
        <input type="date" value={f.nextDate} onChange={set('nextDate')} />
      </label>
      <label>
        Follow-up about
        <input value={f.nextAction} onChange={set('nextAction')} placeholder="e.g. Send rate card, call for approval" maxLength={200} />
      </label>
      <label>
        Invoice no.
        <input value={f.invoiceNo} onChange={set('invoiceNo')} placeholder="When invoiced" maxLength={40} />
      </label>
      <label>
        Payment due by
        <input type="date" value={f.dueDay} onChange={set('dueDay')} />
      </label>
      <label className="ad-span">
        Notes
        <textarea value={f.notes} onChange={set('notes')} rows={2} placeholder="Size, placement, creative due date, discount" maxLength={2000} />
      </label>
      <div className="action-row ad-span">
        <button className="btn" disabled={busy || !f.clientId || f.title.trim().length < 3 || f.amount === ''}>
          {busy ? 'Saving…' : initial ? 'Save deal' : 'Add deal'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/* ---------- one deal ---------- */

function DealCard({ d, client, payments, today, onChange, onEdit }: { d: Deal; client?: Client; payments: Payment[]; today: string; onChange: () => void; onEdit: () => void }) {
  const [paying, setPaying] = useState(false)
  const [open, setOpen] = useState(false)
  const total = totalWithGst(d)
  const balance = balanceOf(d)
  const [p, setP] = useState({ amount: '', day: today, mode: 'bank', ref: '' })
  const overdue = !!d.due_day && d.due_day < today && balance > 0
  const follow = d.next_date && (OPEN.includes(d.stage) || d.stage === 'confirmed' || d.stage === 'running') ? d.next_date : null
  const pay = async (e: FormEvent) => {
    e.preventDefault()
    if (await post('payment', { dealId: d.id, ...p, amount: Number(p.amount) }, 'Payment recorded')) {
      setPaying(false)
      onChange()
    }
  }
  const pct = BOOKED.includes(d.stage) && total ? Math.min(100, (d.received / total) * 100) : 0
  return (
    <li className={`ad-deal stage-${d.stage} ${overdue ? 'overdue' : ''}`}>
      <div className="ad-deal-head">
        <div>
          <strong>{client?.name ?? 'Advertiser'}</strong>
          <span className="ad-deal-title">{d.title}</span>
          <span className="meta">
            {MEDIUM[d.medium] ?? d.medium}
            {d.period && ` · ${d.period}`}
            {d.handled_by && ` · ${d.handled_by}`}
          </span>
        </div>
        <select
          className={`ad-stage s-${d.stage}`}
          value={d.stage}
          aria-label="Stage"
          onChange={async (e) => (await post('deal/update', { id: d.id, stage: e.target.value }, `Moved to ${STAGE_LABEL[e.target.value as Stage]}`)) && onChange()}
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="ad-money">
        <span>
          {inr(d.amount)} <small>+ {d.gst_pct}% GST = {inr(total)}</small>
        </span>
        {BOOKED.includes(d.stage) && (
          <span className={balance ? (overdue ? 'late' : 'due') : 'paid'}>{balance ? `${inr(balance)} due${d.due_day ? ` by ${dayLabel(d.due_day)}` : ''}` : 'Fully paid'}</span>
        )}
      </div>
      {BOOKED.includes(d.stage) && (
        <div className="ad-bar" aria-label={`${Math.round(pct)}% received`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="ad-tags">
        {follow && <span className={`task-tag ${follow < today ? 'late' : ''}`}>{follow < today ? 'Follow-up overdue' : follow === today ? 'Follow up today' : `Follow up ${dayLabel(follow)}`}</span>}
        {d.next_action && follow && <span className="meta">{d.next_action}</span>}
        {d.invoice_no && <span className="task-tag">Invoice {d.invoice_no}</span>}
        {overdue && <span className="task-tag late">Payment overdue</span>}
      </div>
      {open && (
        <div className="ad-more">
          {d.notes && <p className="task-details">{d.notes}</p>}
          {payments.length > 0 ? (
            <ul className="ad-pays">
              {payments.map((x) => (
                <li key={x.id}>
                  <span>
                    {dayLabel(x.day)} · <b>{inr(x.amount)}</b> · {MODE[x.mode] ?? x.mode}
                    {x.ref && ` · ${x.ref}`}
                  </span>
                  <button className="mini-btn danger" onClick={async () => window.confirm('Remove this payment?') && (await post('payment/remove', { id: x.id }, 'Payment removed')) && onChange()}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="meta">No payments yet.</p>
          )}
        </div>
      )}
      {paying && (
        <form className="ad-payform" onSubmit={pay}>
          <input value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} inputMode="numeric" placeholder={`Amount (₹${balance.toLocaleString('en-IN')} due)`} aria-label="Amount received" required />
          <input type="date" value={p.day} max={today} onChange={(e) => setP({ ...p, day: e.target.value })} aria-label="Date received" />
          <select value={p.mode} onChange={(e) => setP({ ...p, mode: e.target.value })} aria-label="Mode">
            {Object.entries(MODE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input value={p.ref} onChange={(e) => setP({ ...p, ref: e.target.value })} placeholder="UTR / cheque no." aria-label="Reference" maxLength={60} />
          <button className="btn small">Save payment</button>
        </form>
      )}
      <div className="task-btns ad-btns">
        {client?.phone && (
          <>
            <a className="mini-btn" href={`tel:${digits(client.phone)}`}>
              Call
            </a>
            <a className="mini-btn" href={`https://wa.me/91${digits(client.phone)}`} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          </>
        )}
        {follow && (
          <button className="mini-btn" onClick={async () => (await post('deal/update', { id: d.id, nextDate: addDays(today, 3) }, 'Next follow-up in 3 days')) && onChange()}>
            Done · +3 days
          </button>
        )}
        {BOOKED.includes(d.stage) && balance > 0 && (
          <button className="mini-btn" onClick={() => setPaying((v) => !v)}>
            + Payment
          </button>
        )}
        {client?.phone && BOOKED.includes(d.stage) && balance > 0 && (
          <a
            className={`mini-btn ${overdue ? 'warn' : ''}`}
            href={`https://wa.me/91${digits(client.phone)}?text=${encodeURIComponent(reminderText(d, client.contact.split(',')[0], ownerRole()?.name ?? ''))}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Payment reminder
          </a>
        )}
        <button className="mini-btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'Less' : `Details${payments.length ? ` (${payments.length})` : ''}`}
        </button>
        <button className="mini-btn" onClick={onEdit}>
          Edit
        </button>
        <button className="mini-btn danger" onClick={async () => window.confirm('Delete this deal and its payments?') && (await post('deal/remove', { id: d.id }, 'Deal deleted')) && onChange()}>
          Delete
        </button>
      </div>
    </li>
  )
}

/* ---------- month chart and top advertisers ---------- */

function FyCharts({ book, fy, clients }: { book: Book; fy: string; clients: Map<number, Client> }) {
  const months = useMemo(() => monthlyFy(book.deals, book.payments, fy), [book, fy])
  const max = Math.max(1, ...months.map((m) => Math.max(m.booked, m.received)))
  const top = useMemo(() => {
    const by = new Map<number, number>()
    for (const d of book.deals) if (BOOKED.includes(d.stage) && fyOf(istDay(d.created_at)) === fy) by.set(d.client_id, (by.get(d.client_id) ?? 0) + totalWithGst(d))
    return [...by].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [book, fy])
  if (!months.some((m) => m.booked || m.received)) return null
  const topMax = Math.max(1, ...top.map((t) => t[1]))
  return (
    <div className="ad-charts">
      <Panel title={`Month by month · FY ${fy}`} note="Booked (with GST) and money received.">
        <div className="ad-chart" role="img" aria-label="Booked and received per month">
          {months.map((m) => (
            <div key={m.month} className="ad-col" title={`${m.label}: booked ${inr(m.booked)}, received ${inr(m.received)}`}>
              <div className="ad-bars">
                <span className="b" style={{ height: `${(m.booked / max) * 100}%` }} />
                <span className="r" style={{ height: `${(m.received / max) * 100}%` }} />
              </div>
              <small>{m.label}</small>
            </div>
          ))}
        </div>
        <p className="ad-legend">
          <span className="b" /> Booked <span className="r" /> Received
        </p>
      </Panel>
      {top.length > 0 && (
        <Panel title="Top advertisers" note={`By booked value in FY ${fy}.`}>
          <ol className="ad-top5">
            {top.map(([id, v]) => (
              <li key={id}>
                <span>{clients.get(id)?.name ?? 'Advertiser'}</span>
                <b>{inrShort(v)}</b>
                <i style={{ width: `${(v / topMax) * 100}%` }} />
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  )
}

/* ---------- the tab ---------- */

export function AdsTab() {
  const res = useAsync('studio:ads', (s) => studio<Book>('ads', undefined, s))
  const [view, setView] = useState<'deals' | 'clients' | 'payments'>('deals')
  const [stage, setStage] = useState<'active' | 'all' | Stage>('active')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Deal | 'new' | null>(null)
  const [editClient, setEditClient] = useState<Client | 'new' | null>(null)
  const book = res.data
  const today = book?.today ?? new Date().toISOString().slice(0, 10)
  const [fy, setFy] = useState(() => fyOf(today))

  const clients = useMemo(() => new Map((book?.clients ?? []).map((c) => [c.id, c])), [book])
  const payByDeal = useMemo(() => {
    const m = new Map<number, Payment[]>()
    for (const p of book?.payments ?? []) m.set(p.deal_id, [...(m.get(p.deal_id) ?? []), p])
    return m
  }, [book])
  const fys = useMemo(() => {
    const set = new Set([fyOf(today), ...(book?.deals ?? []).map((d) => fyOf(istDay(d.created_at))), ...(book?.payments ?? []).map((p) => fyOf(p.day))])
    return [...set].sort().reverse()
  }, [book, today])

  const sums = useMemo(() => {
    const deals = book?.deals ?? []
    const inFy = deals.filter((d) => fyOf(istDay(d.created_at)) === fy)
    const booked = inFy.filter((d) => BOOKED.includes(d.stage)).reduce((s, d) => s + totalWithGst(d), 0)
    const received = (book?.payments ?? []).filter((p) => fyOf(p.day) === fy).reduce((s, p) => s + p.amount, 0)
    const due = deals.reduce((s, d) => s + balanceOf(d), 0)
    const overdue = deals.filter((d) => d.due_day && d.due_day < today).reduce((s, d) => s + balanceOf(d), 0)
    const pipeline = deals.filter((d) => OPEN.includes(d.stage)).reduce((s, d) => s + d.amount, 0)
    const won = inFy.filter((d) => BOOKED.includes(d.stage)).length
    const lost = inFy.filter((d) => d.stage === 'lost').length
    return { booked, received, due, overdue, pipeline, winRate: won + lost ? Math.round((won / (won + lost)) * 100) : null }
  }, [book, fy, today])

  const followUps = useMemo(
    () =>
      (book?.deals ?? [])
        .filter((d) => (d.next_date && d.next_date <= today && (OPEN.includes(d.stage) || d.stage === 'confirmed' || d.stage === 'running')) || (d.due_day && d.due_day < today && balanceOf(d) > 0))
        .sort((a, b) => (a.next_date ?? a.due_day ?? '').localeCompare(b.next_date ?? b.due_day ?? '')),
    [book, today],
  )

  const deals = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (book?.deals ?? []).filter((d) => {
      if (stage === 'active' ? d.stage === 'lost' || (d.stage === 'completed' && balanceOf(d) === 0) : stage !== 'all' && d.stage !== stage) return false
      if (!term) return true
      return [clients.get(d.client_id)?.name, d.title, d.period, d.invoice_no, d.handled_by].some((v) => v?.toLowerCase().includes(term))
    })
  }, [book, stage, q, clients])

  if (res.error && !book) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!book) return <SkeletonList count={3} />

  const clientTotals = (id: number) => {
    const ds = book.deals.filter((d) => d.client_id === id)
    return { n: ds.length, booked: ds.filter((d) => BOOKED.includes(d.stage)).reduce((s, d) => s + totalWithGst(d), 0), due: ds.reduce((s, d) => s + balanceOf(d), 0) }
  }

  return (
    <div className="ads">
      <div className="ad-top">
        <select className="wide-select ad-fy" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
          {fys.map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
        <button className="btn small" onClick={() => setEditing('new')}>
          + New deal
        </button>
      </div>
      <div className="kpis">
        <div className="kpi">
          <b>{inrShort(sums.booked)}</b>
          <span>Booked in FY {fy} (with GST)</span>
        </div>
        <div className="kpi">
          <b>{inrShort(sums.received)}</b>
          <span>Received in FY {fy}</span>
        </div>
        <div className="kpi">
          <b>{inrShort(sums.due)}</b>
          <span>Still to collect</span>
        </div>
        <div className={`kpi ${sums.overdue ? 'warn' : ''}`}>
          <b>{inrShort(sums.overdue)}</b>
          <span>Overdue</span>
        </div>
        <div className="kpi">
          <b>{inrShort(sums.pipeline)}</b>
          <span>In talks (before GST)</span>
        </div>
        {sums.winRate !== null && (
          <div className="kpi">
            <b>{sums.winRate}%</b>
            <span>Deals won (FY {fy})</span>
          </div>
        )}
      </div>

      <FyCharts book={book} fy={fy} clients={clients} />

      {editing && (
        <Panel title={editing === 'new' ? 'New deal' : 'Edit deal'}>
          <DealForm
            key={editing === 'new' ? 'new' : editing.id}
            book={book}
            initial={editing === 'new' ? undefined : editing}
            onCancel={() => setEditing(null)}
            onClientAdded={res.reload}
            onDone={() => {
              setEditing(null)
              res.reload()
            }}
          />
        </Panel>
      )}

      {followUps.length > 0 && (
        <Panel title={`To do today (${followUps.length})`} note="Follow-ups due and payments past their due date.">
          <ul className="task-list ad-list">
            {followUps.map((d) => (
              <DealCard key={d.id} d={d} client={clients.get(d.client_id)} payments={payByDeal.get(d.id) ?? []} today={today} onChange={res.reload} onEdit={() => setEditing(d)} />
            ))}
          </ul>
        </Panel>
      )}

      <div className="segmented wide ad-views" role="tablist" aria-label="Show">
        {(
          [
            ['deals', `Deals (${book.deals.length})`],
            ['clients', `Advertisers (${book.clients.length})`],
            ['payments', `Payments (${book.payments.length})`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
            {label}
          </button>
        ))}
      </div>

      {view === 'deals' && (
        <Panel
          title="Deals"
          actions={
            <button className="mini-btn" onClick={() => download(`ad-deals-${today}.csv`, dealsCsv(deals, clients))}>
              Excel (CSV)
            </button>
          }
        >
          <div className="team-bar">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search advertiser, deal, invoice" aria-label="Search deals" />
            <select className="wide-select" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} aria-label="Stage">
              <option value="active">Active (hide lost and settled)</option>
              <option value="all">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          {deals.length === 0 ? (
            <p className="empty">{book.deals.length ? 'No deals match.' : 'No deals yet. Tap “+ New deal” to add the first one.'}</p>
          ) : (
            <ul className="task-list ad-list">
              {deals.map((d) => (
                <DealCard key={d.id} d={d} client={clients.get(d.client_id)} payments={payByDeal.get(d.id) ?? []} today={today} onChange={res.reload} onEdit={() => setEditing(d)} />
              ))}
            </ul>
          )}
        </Panel>
      )}

      {view === 'clients' && (
        <Panel
          title="Advertisers"
          actions={
            <button className="mini-btn" onClick={() => setEditClient('new')}>
              + Add advertiser
            </button>
          }
        >
          {editClient && (
            <ClientForm
              key={editClient === 'new' ? 'new' : editClient.id}
              initial={editClient === 'new' ? undefined : editClient}
              onCancel={() => setEditClient(null)}
              onDone={() => {
                setEditClient(null)
                res.reload()
              }}
            />
          )}
          {book.clients.length === 0 ? (
            <p className="empty">No advertisers yet.</p>
          ) : (
            <ul className="task-list ad-list">
              {book.clients.map((c) => {
                const t = clientTotals(c.id)
                return (
                  <li key={c.id} className="ad-client">
                    <div>
                      <strong>{c.name}</strong>
                      <span className="meta">{[c.contact, c.city, c.gstin && `GSTIN ${c.gstin}`].filter(Boolean).join(' · ')}</span>
                      <span className="meta">
                        {t.n} deal{t.n === 1 ? '' : 's'} · {inr(t.booked)} booked{t.due ? ` · ` : ''}
                        {t.due > 0 && <b className="ad-due">{inr(t.due)} due</b>}
                      </span>
                    </div>
                    <div className="task-btns ad-btns">
                      {c.phone && (
                        <>
                          <a className="mini-btn" href={`tel:${digits(c.phone)}`}>
                            Call
                          </a>
                          <a className="mini-btn" href={`https://wa.me/91${digits(c.phone)}`} target="_blank" rel="noopener noreferrer">
                            WhatsApp
                          </a>
                        </>
                      )}
                      {c.email && (
                        <a className="mini-btn" href={`mailto:${c.email}`}>
                          Email
                        </a>
                      )}
                      <button className="mini-btn" onClick={() => setEditClient(c)}>
                        Edit
                      </button>
                      <button className="mini-btn danger" onClick={async () => window.confirm(`Remove ${c.name}?`) && (await post('client/remove', { id: c.id }, 'Advertiser removed')) && res.reload()}>
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      )}

      {view === 'payments' && (
        <Panel title="Payments received">
          {book.payments.length === 0 ? (
            <p className="empty">No payments recorded yet. Use “+ Payment” on a confirmed deal.</p>
          ) : (
            <div className="table-wrap">
              <table className="score-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Advertiser</th>
                    <th>Deal</th>
                    <th>Amount</th>
                    <th>Mode</th>
                    <th>Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {book.payments.map((p) => {
                    const d = book.deals.find((x) => x.id === p.deal_id)
                    return (
                      <tr key={p.id}>
                        <td>{dayLabel(p.day)}</td>
                        <td>{d ? clients.get(d.client_id)?.name : ''}</td>
                        <td>{d?.title}</td>
                        <td>
                          <b>{inr(p.amount)}</b>
                        </td>
                        <td>{MODE[p.mode] ?? p.mode}</td>
                        <td>{p.ref}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}
