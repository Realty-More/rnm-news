// Magazine mailing list in the Content Studio (owner and team only).
// One address book for the quarterly print issue: who gets it, and whether each copy was sent,
// delivered or came back. Prints address labels and exports the list for the courier.
import { useMemo, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDateTime } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { hasFullAccess, studio, studioPost } from '../lib/owner.ts'

export interface Contact {
  id: number
  name: string
  designation: string | null
  company: string | null
  address: string | null
  city: string | null
  pin: string | null
  phone: string | null
  email: string | null
  remark: string | null
}
type Status = 'pending' | 'sent' | 'delivered' | 'returned'
interface Issue { id: string; title: string; marked: number; sent: number | null; delivered: number | null; returned: number | null }
interface Book { contacts: Contact[]; issues: Issue[]; current: string }
interface Dispatch { id: number; status: Status; courier: string | null; tracking: string | null; byName: string | null; at: string }

const STATUS_LABEL: Record<Status, string> = { pending: 'Not sent', sent: 'Sent', delivered: 'Delivered', returned: 'Returned' }
const EMPTY: Omit<Contact, 'id'> = { name: '', designation: '', company: '', address: '', city: '', pin: '', phone: '', email: '', remark: '' }

const initials = (name: string) =>
  name
    .replace(/^(mr|mrs|ms|dr|shri|smt)\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

/** Next quarter after "2026-Q4" → { id: "2027-Q1", title: "Jan–Mar 2027" }. */
export function nextQuarter(id: string): { id: string; title: string } {
  const [y, q] = id.split('-Q').map(Number)
  const ny = q === 4 ? y + 1 : y
  const nq = q === 4 ? 1 : q + 1
  return { id: `${ny}-Q${nq}`, title: `${['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'][nq - 1]} ${ny}` }
}

/** Quarter before "2026-Q4" → { id: "2026-Q3", title: "Jul–Sep 2026" }. */
export function prevQuarter(id: string): { id: string; title: string } {
  const [y, q] = id.split('-Q').map(Number)
  const py = q === 1 ? y - 1 : y
  const pq = q === 1 ? 4 : q - 1
  return { id: `${py}-Q${pq}`, title: `${['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'][pq - 1]} ${py}` }
}

/** CSV the courier (or Excel) can open; one row per contact with this issue's status. */
export function mailingCsv(rows: Contact[], status: Map<number, Dispatch>, issue: string): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Name', 'Designation', 'Company', 'Address', 'City', 'PIN', 'Phone', 'Email', `Status (${issue})`, 'Courier', 'Tracking no.']
  const lines = rows.map((c) => {
    const d = status.get(c.id)
    return [c.name, c.designation, c.company, c.address, c.city, c.pin, c.phone, c.email, STATUS_LABEL[d?.status ?? 'pending'], d?.courier, d?.tracking].map(esc).join(',')
  })
  return '﻿' + [head.map(esc).join(','), ...lines].join('\r\n')
}

const html = (s: string | null) => (s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

/** A4 sheet of 14 address labels (99 × 38 mm, the common 2 × 7 layout) in a print window. */
function printLabels(rows: Contact[], issueTitle: string) {
  const w = window.open('', '_blank')
  if (!w) return toast('Allow pop-ups to print labels')
  const labels = rows
    .map(
      (c) => `<div class="l"><b>${html(c.name)}</b>${c.designation ? `<span>${html(c.designation)}</span>` : ''}${c.company ? `<i>${html(c.company)}</i>` : ''}<p>${html(c.address)}${c.pin && !(c.address ?? '').replace(/\D/g, '').includes(c.pin) ? ` – ${c.pin}` : ''}</p>${c.phone ? `<small>Ph: ${html(c.phone)}</small>` : ''}</div>`,
    )
    .join('')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Address labels · ${html(issueTitle)}</title><style>
    @page { size: A4; margin: 15mm 5mm 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 9.5pt/1.3 Arial, sans-serif; color: #000; }
    .sheet { display: grid; grid-template-columns: 99.1mm 99.1mm; grid-auto-rows: 38.1mm; column-gap: 2.5mm; }
    .l { padding: 3mm 4mm; overflow: hidden; break-inside: avoid; border: 0.2mm dashed #bbb; }
    .l b { display: block; font-size: 10.5pt; }
    .l span, .l i { display: block; font-style: normal; }
    .l i { font-weight: 700; }
    .l p { margin: 1mm 0 0; }
    .l small { display: block; margin-top: 0.5mm; }
    @media print { .l { border-color: transparent; } .tip { display: none; } }
    .tip { font: 11pt Arial; padding: 8px 12px; background: #fff7e0; }
  </style></head><body><div class="tip">${rows.length} labels · ${html(issueTitle)} · Print on A4 label sheets (2 × 7). Choose “Actual size”, not “Fit to page”.</div><div class="sheet">${labels}</div><script>setTimeout(() => print(), 300)</script></body></html>`)
  w.document.close()
}

export function MagazineTab() {
  const book = useAsync('studio:mag-book', (s) => studio<Book>('mag/book', undefined, s))
  const [issue, setIssue] = useState<string | null>(null)
  const issueId = issue ?? book.data?.current ?? null
  const disp = useAsync(issueId ? `studio:mag-dispatch:${issueId}` : null, (s) => studio<{ rows: Dispatch[] }>(`mag/dispatch?issue=${issueId}`, undefined, s))
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [show, setShow] = useState<'all' | Status>('all')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [courier, setCourier] = useState('')
  const [editing, setEditing] = useState<Contact | Omit<Contact, 'id'> | null>(null)
  const [busy, setBusy] = useState(false)
  const isOwner = hasFullAccess()

  const status = useMemo(() => new Map((disp.data?.rows ?? []).map((d) => [d.id, d])), [disp.data])
  const contacts = book.data?.contacts ?? []
  const cities = useMemo(() => {
    const n = new Map<string, number>()
    for (const c of contacts) n.set(c.city ?? 'Other', (n.get(c.city ?? 'Other') ?? 0) + 1)
    return [...n].sort((a, b) => b[1] - a[1])
  }, [contacts])
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return contacts.filter((c) => {
      if (city && (c.city ?? 'Other') !== city) return false
      if (show !== 'all' && (status.get(c.id)?.status ?? 'pending') !== show) return false
      const hay = `${c.name} ${c.designation ?? ''} ${c.company ?? ''} ${c.address ?? ''} ${c.phone ?? ''} ${c.pin ?? ''}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [contacts, q, city, show, status])

  const counts = useMemo(() => {
    const c = { pending: 0, sent: 0, delivered: 0, returned: 0 }
    for (const x of contacts) c[status.get(x.id)?.status ?? 'pending']++
    return c
  }, [contacts, status])

  if (book.error && !book.data) return <ErrorState error={book.error} onRetry={book.reload} />
  if (!book.data) return <SkeletonList count={4} />
  const issues = book.data.issues
  const current = issues.find((i) => i.id === issueId)
  const done = counts.sent + counts.delivered
  const pct = contacts.length ? Math.round(((done + counts.returned) / contacts.length) * 100) : 0

  const mark = async (ids: number[], s: Status) => {
    if (!issueId || !ids.length) return
    setBusy(true)
    try {
      await studioPost('mag/dispatch', { issue: issueId, ids, status: s, courier: courier.trim() || undefined })
      toast(`${ids.length} marked ${STATUS_LABEL[s].toLowerCase()}`)
      setPicked(new Set())
      disp.reload()
      book.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Next: the quarter after the newest issue. Earlier: the quarter before the oldest (for a missed issue).
  const newIssue = async (earlier = false) => {
    const next = earlier ? prevQuarter(issues[issues.length - 1]?.id ?? book.data!.current) : nextQuarter(issues[0]?.id ?? book.data!.current)
    if (!window.confirm(`Add the ${next.title} issue?`)) return
    try {
      await studioPost('mag/issue', next)
      toast(`${next.title} issue added`)
      setIssue(next.id)
      book.reload()
    } catch (e) {
      toast((e as Error).message)
    }
  }

  const download = () => {
    const blob = new Blob([mailingCsv(shown, status, current?.title ?? issueId ?? '')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `magazine-list-${issueId}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const allShownPicked = shown.length > 0 && shown.every((c) => picked.has(c.id))
  const forLabels = picked.size ? contacts.filter((c) => picked.has(c.id)) : shown

  return (
    <div className="mag">
      <div className="mag-issue">
        <div>
          <span className="dateline">Quarterly print issue</span>
          <div className="mag-issue-row">
            <select className="wide-select" value={issueId ?? ''} onChange={(e) => setIssue(e.target.value)} aria-label="Issue">
              {issues.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title} ({i.id.replace('-', ' ')})
                </option>
              ))}
            </select>
            {isOwner && (
              <>
                <button className="btn ghost small" onClick={() => newIssue(true)}>
                  + Earlier issue
                </button>
                <button className="btn ghost small" onClick={() => newIssue()}>
                  + Next issue
                </button>
              </>
            )}
          </div>
        </div>
        <div className="mag-progress" aria-label={`${pct}% done`}>
          <div className="mag-bar">
            <span className="seg delivered" style={{ width: `${(counts.delivered / Math.max(1, contacts.length)) * 100}%` }} />
            <span className="seg sent" style={{ width: `${(counts.sent / Math.max(1, contacts.length)) * 100}%` }} />
            <span className="seg returned" style={{ width: `${(counts.returned / Math.max(1, contacts.length)) * 100}%` }} />
          </div>
          <span>{pct}% dispatched</span>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <b>{contacts.length}</b>
          <span>Contacts · {cities.length} cities</span>
        </div>
        <div className="kpi">
          <b>{counts.pending}</b>
          <span>Not sent yet</span>
        </div>
        <div className="kpi">
          <b>{done}</b>
          <span>Sent ({counts.delivered} delivered)</span>
        </div>
        <div className={`kpi ${counts.returned ? 'warn' : ''}`}>
          <b>{counts.returned}</b>
          <span>Returned: fix address</span>
        </div>
      </div>

      <div className="mag-tools">
        <label className="mag-search">
          <Icon name="search" size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, address, phone, PIN" aria-label="Search contacts" />
        </label>
        <select className="wide-select" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
          <option value="">All cities</option>
          {cities.map(([c, n]) => (
            <option key={c} value={c}>
              {c} ({n})
            </option>
          ))}
        </select>
        <div className="segmented small" role="radiogroup" aria-label="Status">
          {(['all', 'pending', 'sent', 'delivered', 'returned'] as const).map((s) => (
            <button key={s} role="radio" aria-checked={show === s} className={show === s ? 'on' : ''} onClick={() => setShow(s)}>
              {s === 'all' ? 'All' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="mag-actions">
        <label className="mag-check">
          <input type="checkbox" checked={allShownPicked} onChange={() => setPicked(allShownPicked ? new Set() : new Set(shown.map((c) => c.id)))} />
          {picked.size ? `${picked.size} selected` : `Select all ${shown.length}`}
        </label>
        <button className="btn ghost small" onClick={() => setEditing({ ...EMPTY })}>
          + Add contact
        </button>
        <button className="btn ghost small" onClick={() => printLabels(forLabels, current?.title ?? '')} disabled={!forLabels.length}>
          Print {forLabels.length} labels
        </button>
        <button className="btn ghost small" onClick={download} disabled={!shown.length}>
          <Icon name="download" size={15} /> Excel (CSV)
        </button>
      </div>

      {picked.size > 0 && (
        <div className="mag-bulk" role="region" aria-label="Update selected">
          <strong>{picked.size} selected</strong>
          <input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Courier (optional), e.g. DTDC" aria-label="Courier" />
          <div className="mag-bulk-btns">
            <button className="btn small" disabled={busy} onClick={() => mark([...picked], 'sent')}>
              Mark sent
            </button>
            <button className="btn ghost small" disabled={busy} onClick={() => mark([...picked], 'delivered')}>
              Delivered
            </button>
            <button className="btn ghost small" disabled={busy} onClick={() => mark([...picked], 'returned')}>
              Returned
            </button>
            <button className="btn ghost small" disabled={busy} onClick={() => mark([...picked], 'pending')}>
              Reset
            </button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="panel-note">No contacts match.</p>
      ) : (
        <ul className="mag-list">
          {shown.map((c) => {
            const d = status.get(c.id)
            const s = d?.status ?? 'pending'
            return (
              <li key={c.id} className={`mag-card ${picked.has(c.id) ? 'picked' : ''}`}>
                <input type="checkbox" className="mag-pick" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} />
                <span className="mag-avatar" aria-hidden="true">
                  {initials(c.name)}
                </span>
                <div className="mag-main">
                  <div className="mag-head">
                    <div>
                      <strong className="mag-name">{c.name}</strong>
                      <span className="mag-role">{[c.designation, c.company].filter(Boolean).join(' · ')}</span>
                    </div>
                    <span className={`mag-status ${s}`}>{STATUS_LABEL[s]}</span>
                  </div>
                  {c.address ? <p className="mag-address">{c.address}</p> : <p className="mag-address missing">No address yet</p>}
                  <div className="mag-meta">
                    {c.city && <span className="mag-chip">{c.city}</span>}
                    {c.pin && <span className="mag-chip">PIN {c.pin}</span>}
                    {c.phone && (
                      <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="mag-chip phone">
                        {c.phone}
                      </a>
                    )}
                    {d && d.status !== 'pending' && (
                      <span className="mag-by">
                        {STATUS_LABEL[d.status]} {d.courier ? `via ${d.courier} ` : ''}· {d.byName} · {formatDateTime(d.at)}
                      </span>
                    )}
                  </div>
                  <div className="mag-row-btns">
                    {s === 'pending' && (
                      <button className="mini-btn" disabled={busy} onClick={() => mark([c.id], 'sent')}>
                        Mark sent
                      </button>
                    )}
                    {s === 'sent' && (
                      <>
                        <button className="mini-btn" disabled={busy} onClick={() => mark([c.id], 'delivered')}>
                          Delivered
                        </button>
                        <button className="mini-btn" disabled={busy} onClick={() => mark([c.id], 'returned')}>
                          Returned
                        </button>
                      </>
                    )}
                    {s !== 'pending' && (
                      <button className="mini-btn" disabled={busy} onClick={() => mark([c.id], 'pending')}>
                        Undo
                      </button>
                    )}
                    <button className="mini-btn" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <ContactForm
          contact={editing}
          canRemove={isOwner && 'id' in editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            book.reload()
          }}
        />
      )}
    </div>
  )
}

function ContactForm({ contact, canRemove, onClose, onSaved }: { contact: Contact | Omit<Contact, 'id'>; canRemove: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ...contact })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Omit<Contact, 'id'>) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await studioPost('mag/contact', f)
      toast('Contact saved')
      onSaved()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!('id' in f) || !window.confirm(`Remove ${f.name} from the magazine list?`)) return
    try {
      await studioPost('mag/contact/remove', { id: f.id })
      toast('Removed from the list')
      onSaved()
    } catch (err) {
      toast((err as Error).message)
    }
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet mag-form" onSubmit={save} onClick={(e) => e.stopPropagation()} aria-label="Contact">
        <div className="sheet-head">
          <h2>{'id' in f ? 'Edit contact' : 'Add contact'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="form-grid">
          <input value={f.name} onChange={set('name')} placeholder="Full name with title (Mr. / Ms.)" aria-label="Name" required />
          <input value={f.designation ?? ''} onChange={set('designation')} placeholder="Designation" aria-label="Designation" />
          <input value={f.company ?? ''} onChange={set('company')} placeholder="Company" aria-label="Company" />
          <textarea value={f.address ?? ''} onChange={set('address')} placeholder="Full postal address" aria-label="Address" rows={3} />
          <input value={f.city ?? ''} onChange={set('city')} placeholder="City (filled from the address if empty)" aria-label="City" />
          <input value={f.pin ?? ''} onChange={set('pin')} placeholder="PIN code" aria-label="PIN code" inputMode="numeric" maxLength={6} />
          <input value={f.phone ?? ''} onChange={set('phone')} placeholder="Phone" aria-label="Phone" inputMode="tel" />
          <input value={f.email ?? ''} onChange={set('email')} placeholder="Email" aria-label="Email" type="email" />
          <input value={f.remark ?? ''} onChange={set('remark')} placeholder="Remark" aria-label="Remark" />
        </div>
        <div className="action-row">
          <button className="btn" disabled={busy || !f.name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {canRemove && (
            <button type="button" className="btn ghost" onClick={remove}>
              <Icon name="trash" size={16} /> Remove
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
