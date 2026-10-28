// Studio → Sales → Media kit (owner and full-access staff only; other employees never see it).
//   The rate-card PDFs are kept on the app server, never in the public app. To send them, make a
//   private link for one advertiser: a branded page "Prepared for <company>" with only the kits
//   picked, valid for a few days. The list shows who opened it, when, and what they downloaded;
//   the first open also sends a notification to the owner's phone.
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { useAsync } from '../lib/hooks.ts'
import { ownerKey, ownerRole, studio, studioPost } from '../lib/owner.ts'
import { PUSH_API } from '../lib/push.ts'
import { Dialog, RowMenu } from './EmployeesTools.tsx'
import { PdfPage, type PdfDoc } from './Magazine.tsx'
import { Panel } from './StudioTools.tsx'

interface KitFile {
  id: string
  title: string
  file_name: string
  size: number
  pages: number
  has_cover: number
  by_name: string
  updated_at: string
  cover: string | null
}
interface KitLink {
  token: string
  company: string
  person: string
  phone: string
  files: string[]
  by_name: string
  created_at: string
  expires_at: string
  revoked: number
  opens: number
  downloads: number
  first_open: string | null
  last_open: string | null
}
interface Settings {
  contactName: string
  contactTitle: string
  contactPhone: string
  contactEmail: string
  intro: string
}
interface Book {
  now: string
  files: KitFile[]
  links: KitLink[]
  settings: Settings
  validDays: number[]
}
interface View {
  at: string
  kind: 'open' | 'view' | 'download'
  fileId: string | null
  device: string
  place: string | null
}
interface Client {
  id: number
  name: string
  contact: string
  phone: string
}

const SERVER = PUSH_API.replace(/\/$/, '')
const linkUrl = (token: string) => `${SERVER}/k/${token}`
const digits = (s: string) => s.replace(/\D/g, '')
const waNumber = (phone: string) => (digits(phone).length === 10 ? `91${digits(phone)}` : digits(phone))
const sizeOf = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).replace(/\b(am|pm)\b/, (m) => m.toUpperCase())

/** "REALTY&MORE- Magazine offernings -13th Anniversary Edition.pdf" → a clean starting title. */
export function titleFromFile(name: string): string {
  return name
    .replace(/\.pdf$/i, '')
    .replace(/realty\s*&\s*more|realty\s*n\s*more|r&m/gi, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\s*-\s*/g, ' · ')
    .replace(/^[\s·]+|[\s·]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bOffernings\b/g, 'Offerings')
    .replace(/(\d)(St|Nd|Rd|Th)\b/g, (_, d, s) => d + s.toLowerCase())
    .slice(0, 90)
}

export function shareMessage(l: { person: string; company: string; url: string; expires: string }, from: string): string {
  return [
    `Dear ${l.person.trim() || 'Sir/Madam'},`,
    '',
    'Greetings from Realty & More.',
    '',
    'Please find our media kit with the latest advertising and partnership options across our print magazine, realtynmore.com, YouTube and podcasts:',
    l.url,
    '',
    `The link is valid until ${day(l.expires)}. We would be glad to walk you through the options and put together a plan for ${l.company}.`,
    '',
    'Warm regards,',
    from || 'Team Realty & More',
    'Realty & More',
  ].join('\n')
}

type Status = { label: string; tone: 'ok' | 'wait' | 'off' | 'online' }
function statusOf(l: KitLink, now: number): Status {
  if (l.revoked) return { label: 'Stopped', tone: 'off' }
  if (Date.parse(l.expires_at) < now) return { label: `Expired ${day(l.expires_at)}`, tone: 'off' }
  if (l.downloads) return { label: `Downloaded${l.downloads > 1 ? ` ${l.downloads}×` : ''}`, tone: 'online' }
  if (l.opens) return { label: `Opened${l.opens > 1 ? ` ${l.opens}×` : ''}`, tone: 'ok' }
  return { label: 'Not opened yet', tone: 'wait' }
}

/** First page of a PDF as a JPEG cover, plus the page count (pdf.js, loaded only when needed). */
async function pdfCover(file: File): Promise<{ pages: number; cover: Blob | null }> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const vp = page.getViewport({ scale: 760 / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport: vp, canvas } as Parameters<typeof page.render>[0]).promise
    let q = 0.82
    let cover = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q))
    while (cover && cover.size > 380_000 && q > 0.4) {
      q -= 0.12
      cover = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q))
    }
    return { pages: doc.numPages, cover }
  } finally {
    await doc.destroy()
  }
}

async function upload(path: string, query: Record<string, string>, body: Blob, type: string) {
  const r = await fetch(`${SERVER}/editor/${path}?${new URLSearchParams(query)}`, { method: 'POST', headers: { Authorization: `Bearer ${ownerKey()}`, 'Content-Type': type }, body })
  const j = (await r.json().catch(() => ({}))) as { error?: string; id?: string }
  if (!r.ok) throw new Error(j.error ?? `Upload failed (${r.status})`)
  return j
}

/* ---------- files ---------- */

function FileDialog({ file, existing, onClose, onSaved }: { file: File; existing?: KitFile; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(existing?.title ?? titleFromFile(file.name))
  const [busy, setBusy] = useState(false)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { pages, cover } = await pdfCover(file).catch(() => ({ pages: 0, cover: null }))
      const q: Record<string, string> = { name: file.name, title: title.trim(), pages: String(pages) }
      if (existing) q.id = existing.id
      const { id } = await upload('kit/upload', q, file, 'application/pdf')
      if (cover && id) await upload('kit/cover', { id }, cover, 'image/jpeg').catch(() => toast('Saved, but the cover picture could not be made.'))
      toast(existing ? 'Media kit updated. Links already shared now show the new PDF.' : 'Media kit added')
      onSaved()
    } catch (err) {
      toast((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Dialog title={existing ? 'Replace PDF' : 'Add media kit'} onClose={busy ? () => {} : onClose}>
      <form className="form-grid mk-form" onSubmit={(e) => void save(e)}>
        <p className="meta">
          {file.name} · {sizeOf(file.size)}
        </p>
        <label>
          Name advertisers will see
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={90} required minLength={3} placeholder="e.g. Magazine · 13th Anniversary Edition" />
        </label>
        <div className="action-row">
          <button className="btn" disabled={busy || title.trim().length < 3}>
            {busy ? 'Uploading…' : existing ? 'Replace PDF' : 'Add media kit'}
          </button>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function RenameDialog({ file, onClose, onSaved }: { file: KitFile; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(file.title)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await studioPost('kit/file', { id: file.id, title })
      toast('Name saved')
      onSaved()
    } catch (err) {
      toast((err as Error).message)
    }
  }
  return (
    <Dialog title="Rename media kit" onClose={onClose}>
      <form className="form-grid mk-form" onSubmit={(e) => void save(e)}>
        <label>
          Name advertisers will see
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={90} required minLength={3} autoFocus />
        </label>
        <div className="action-row">
          <button className="btn">Save</button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/* ---------- reading a kit inside the app ---------- */

function KitReader({ file, onClose, onShare }: { file: KitFile; onClose: () => void; onShare: () => void }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [error, setError] = useState('')
  const [ratio, setRatio] = useState(1.414)
  const [zoom, setZoom] = useState(1)
  const [page, setPage] = useState(1)
  const [fit, setFit] = useState(() => Math.min(window.innerWidth - 24, 900))
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const on = () => setFit(Math.min(window.innerWidth - 24, 900))
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('resize', on)
    window.addEventListener('keydown', key)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('keydown', key)
      document.body.style.overflow = ''
    }
  }, [onClose])
  useEffect(() => {
    let dead = false
    let loaded: PdfDoc | null = null
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        const d = await pdfjs.getDocument({ url: `${SERVER}/editor/kit/pdf?id=${file.id}`, httpHeaders: { Authorization: `Bearer ${ownerKey() ?? ''}` }, disableRange: true, disableStream: true }).promise
        if (dead) return void d.destroy()
        loaded = d
        const vp = (await d.getPage(1)).getViewport({ scale: 1 })
        setRatio(vp.height / vp.width)
        setDoc(d)
      } catch {
        if (!dead) setError('Could not open this PDF. Check the internet and try again.')
      }
    })()
    return () => {
      dead = true
      void loaded?.destroy()
    }
  }, [file.id])
  const onScroll = () => {
    const mid = window.innerHeight / 2
    for (const el of box.current?.querySelectorAll<HTMLElement>('.pdf-page') ?? []) {
      const r = el.getBoundingClientRect()
      if (r.top <= mid && r.bottom >= mid) return setPage(Number(el.dataset.page))
    }
  }
  const width = Math.round(fit * zoom)
  return (
    <div className="mk-reader" role="dialog" aria-modal="true" aria-label={file.title}>
      <div className="mz-bar">
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="mz-bar-title">
          <strong>{file.title}</strong>
          <span>{doc ? `Page ${page} of ${doc.numPages}` : error ? '' : 'Opening…'}</span>
        </div>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))} disabled={zoom <= 1} aria-label="Zoom out">
          −
        </button>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.min(3, +(z + 0.5).toFixed(1)))} disabled={zoom >= 3} aria-label="Zoom in">
          +
        </button>
        <button className="btn small mk-wa" onClick={onShare}>
          WhatsApp
        </button>
      </div>
      <div className="mk-reader-body" ref={box} onScroll={onScroll}>
        {error ? (
          <p className="empty">{error}</p>
        ) : !doc ? (
          <div className="mz-loading">{file.cover && <img src={file.cover} alt="" />}</div>
        ) : (
          <div className={`pdf-pages ${zoom > 1 ? 'zoomed' : ''}`}>
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={`${i}-${width}`} doc={doc} n={i + 1} width={width} ratio={ratio} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- sharing ---------- */

function ShareResult({ link, onDone }: { link: { company: string; person: string; phone: string; url: string; expires: string }; onDone: () => void }) {
  const msg = shareMessage(link, ownerRole()?.name ?? '')
  const wa = link.phone ? `https://wa.me/${waNumber(link.phone)}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`
  const canShare = typeof navigator.share === 'function'
  return (
    <div className="mk-result">
      <p className="login-card-ok">✓ Link ready for {link.company}</p>
      <p className="mk-url">{link.url}</p>
      <p className="meta">Valid until {day(link.expires)}. You will see here when they open it.</p>
      <pre className="mk-msg">{msg}</pre>
      <div className="action-row">
        <a className="btn small" href={wa} target="_blank" rel="noopener noreferrer">
          Send on WhatsApp
        </a>
        {canShare && (
          <button className="btn ghost small" onClick={() => void navigator.share({ title: 'Realty & More Media Kit', text: msg }).catch(() => {})}>
            Share…
          </button>
        )}
        <button className="btn ghost small" onClick={() => void navigator.clipboard.writeText(msg).then(() => toast('Message copied'))}>
          Copy message
        </button>
        <button className="btn ghost small" onClick={() => void navigator.clipboard.writeText(link.url).then(() => toast('Link copied'))}>
          Copy link
        </button>
        <button className="btn ghost small" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )
}

function ShareDialog({ book, only, onClose, onSaved }: { book: Book; only?: string[]; onClose: () => void; onSaved: () => void }) {
  const clients = useAsync('studio:kit-clients', (s) => studio<{ clients: Client[] }>('ads', undefined, s))
  const [f, setF] = useState({ clientId: '', company: '', person: '', phone: '', days: 15 })
  const [files, setFiles] = useState<string[]>(only?.length ? only : book.files.map((x) => x.id))
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<{ company: string; person: string; phone: string; url: string; expires: string } | null>(null)
  const pickClient = (id: string) => {
    const c = clients.data?.clients.find((x) => String(x.id) === id)
    setF((v) => (c ? { ...v, clientId: id, company: c.name, person: c.contact.split(',')[0].trim(), phone: c.phone } : { ...v, clientId: '' }))
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await studioPost<{ url: string; expires: string }>('kit/link', { ...f, clientId: f.clientId ? Number(f.clientId) : null, files })
      setMade({ company: f.company.trim(), person: f.person, phone: f.phone, url: r.url, expires: r.expires })
      onSaved()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const set = (k: 'company' | 'person' | 'phone') => (e: ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }))
  return (
    <Dialog title="Share media kit" onClose={onClose}>
      {made ? (
        <ShareResult link={made} onDone={onClose} />
      ) : (
        <form className="form-grid mk-form" onSubmit={(e) => void save(e)}>
          {(clients.data?.clients.length ?? 0) > 0 && (
            <label>
              From Ad sales <small>(optional)</small>
              <select value={f.clientId} onChange={(e) => pickClient(e.target.value)}>
                <option value="">Pick an advertiser, or type below</option>
                {clients.data!.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Company
            <input value={f.company} onChange={set('company')} maxLength={100} required minLength={2} placeholder="e.g. Godrej Properties" />
          </label>
          <div className="mk-two">
            <label>
              Contact person <small>(optional)</small>
              <input value={f.person} onChange={set('person')} maxLength={80} placeholder="e.g. Mr. Mehta" />
            </label>
            <label>
              WhatsApp number <small>(optional)</small>
              <input value={f.phone} onChange={set('phone')} inputMode="tel" maxLength={30} placeholder="Mobile number" />
            </label>
          </div>
          <fieldset className="mk-pick">
            <legend>Media kits to share</legend>
            {book.files.map((x) => (
              <label key={x.id} className="auth-check">
                <input type="checkbox" checked={files.includes(x.id)} onChange={(e) => setFiles((v) => (e.target.checked ? [...v, x.id] : v.filter((id) => id !== x.id)))} />
                {x.title}
              </label>
            ))}
          </fieldset>
          <label>
            Link works for
            <select value={f.days} onChange={(e) => setF((v) => ({ ...v, days: Number(e.target.value) }))}>
              {book.validDays.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <div className="action-row">
            <button className="btn" disabled={busy || !files.length || f.company.trim().length < 2}>
              {busy ? 'Making the link…' : 'Create share link'}
            </button>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

function ActivityDialog({ link, files, onClose }: { link: KitLink; files: KitFile[]; onClose: () => void }) {
  const res = useAsync(`studio:kit-views:${link.token}`, (s) => studio<{ views: View[] }>(`kit/views?token=${link.token}`, undefined, s))
  const nameOf = (id: string | null) => files.find((f) => f.id === id)?.title ?? 'a media kit'
  return (
    <Dialog title={`Activity · ${link.company}`} onClose={onClose}>
      <p className="meta">
        Shared by {link.by_name} on {day(link.created_at)} · valid until {day(link.expires_at)}
      </p>
      {res.error && !res.data ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <SkeletonList count={2} />
      ) : res.data.views.length === 0 ? (
        <p className="empty">Not opened yet. WhatsApp link previews are not counted, only real visits.</p>
      ) : (
        <ol className="mk-activity">
          {res.data.views.map((v, i) => (
            <li key={i}>
              <strong>{v.kind === 'open' ? 'Opened the page' : v.kind === 'download' ? `Downloaded “${nameOf(v.fileId)}”` : `Read “${nameOf(v.fileId)}”`}</strong>
              <span className="meta">
                {when(v.at)} · {v.device}
                {v.place ? ` · ${v.place}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  )
}

/* ---------- settings ---------- */

function ContactPanel({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [s, setS] = useState(settings)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Settings) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS((v) => ({ ...v, [k]: e.target.value }))
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await studioPost('kit/settings', s)
      toast('Saved. Every shared page now shows this.')
      onSaved()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title="Contact on the shared page" note="Advertisers see this with Call, WhatsApp and Email buttons.">
      <form className="form-grid mk-form" onSubmit={(e) => void save(e)}>
        <div className="mk-two">
          <label>
            Name
            <input value={s.contactName} onChange={set('contactName')} maxLength={80} placeholder="e.g. Ronit Sabharwal" />
          </label>
          <label>
            Designation
            <input value={s.contactTitle} onChange={set('contactTitle')} maxLength={80} placeholder="e.g. Business Development" />
          </label>
          <label>
            Mobile
            <input value={s.contactPhone} onChange={set('contactPhone')} inputMode="tel" maxLength={30} />
          </label>
          <label>
            Email
            <input value={s.contactEmail} onChange={set('contactEmail')} type="email" maxLength={120} />
          </label>
        </div>
        <label>
          Welcome note
          <textarea value={s.intro} onChange={set('intro')} rows={3} maxLength={600} />
        </label>
        <div className="action-row">
          <button className="btn small" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Panel>
  )
}

/* ---------- the tab ---------- */

type Filter = 'all' | 'opened' | 'waiting' | 'ended'

export function MediaKitTab() {
  const res = useAsync('studio:kit', (s) => studio<Book>('kit', undefined, s))
  const [adding, setAdding] = useState<{ file: File; existing?: KitFile } | null>(null)
  const [renaming, setRenaming] = useState<KitFile | null>(null)
  const [sharing, setSharing] = useState<string[] | null>(null)
  const [reading, setReading] = useState<KitFile | null>(null)
  const [removing, setRemoving] = useState<KitFile | null>(null)
  const replaceFor = useRef<KitFile | undefined>(undefined)
  const replaceInput = useRef<HTMLInputElement>(null)
  const [activity, setActivity] = useState<KitLink | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const book = res.data
  const now = book ? Date.parse(book.now) : Date.now()

  const counts = useMemo(() => {
    const links = book?.links ?? []
    const live = links.filter((l) => !l.revoked && Date.parse(l.expires_at) >= now)
    return { live: live.length, opened: links.filter((l) => l.opens > 0).length, downloads: links.reduce((n, l) => n + l.downloads, 0), waiting: live.filter((l) => !l.opens).length }
  }, [book, now])
  const shown = (book?.links ?? []).filter((l) => {
    const ended = !!l.revoked || Date.parse(l.expires_at) < now
    return filter === 'all' ? true : filter === 'opened' ? l.opens > 0 : filter === 'waiting' ? !ended && !l.opens : ended
  })

  const pick = (existing?: KitFile) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast('Pick a PDF file.')
    if (file.size > 20 * 1024 * 1024) return toast('PDFs up to 20 MB, please.')
    setAdding({ file, existing })
  }
  const preview = async () => {
    // Opened first so the browser does not block it as a pop-up.
    const w = window.open('', '_blank')
    try {
      const r = await studioPost<{ url: string }>('kit/preview', { company: 'Your company' })
      if (w) w.location.href = r.url
      else window.location.href = r.url
    } catch (err) {
      w?.close()
      toast((err as Error).message)
    }
  }
  const act = async (l: KitLink, action: 'stop' | 'restart' | 'extend' | 'remove') => {
    if (action === 'remove' && !window.confirm(`Delete the link for ${l.company}? It stops working and its activity is removed.`)) return
    if (action === 'stop' && !window.confirm(`Stop the link for ${l.company}? It will show "no longer active".`)) return
    try {
      await studioPost('kit/link/change', { token: l.token, action, days: 15 })
      toast(action === 'extend' ? 'Link extended by 15 days' : action === 'stop' ? 'Link stopped' : action === 'restart' ? 'Link working again' : 'Link deleted')
      res.reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }
  const move = async (f: KitFile, dir: 'up' | 'down') => {
    await studioPost('kit/move', { id: f.id, dir }).catch((err) => toast((err as Error).message))
    res.reload()
  }
  const remove = async (f: KitFile) => {
    try {
      await studioPost('kit/remove', { id: f.id })
      toast(`“${f.title}” removed`)
    } catch (err) {
      toast((err as Error).message)
    }
    setRemoving(null)
    res.reload()
  }

  if (res.error && !book) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!book) return <SkeletonList count={3} />
  const titles = (ids: string[]) => ids.map((id) => book.files.find((f) => f.id === id)?.title).filter(Boolean).join(' · ') || 'Removed media kit'

  return (
    <>
      <Panel
        title="Media kit"
        note="Only the owner and full-access staff see this. Share a private link with an advertiser: they get a page made for their company, and you see when they open it."
        actions={
          book.files.length > 0 ? (
            <button className="btn small" onClick={() => setSharing([])}>
              Share media kit
            </button>
          ) : undefined
        }
      >
        <div className="kpis">
          <div className="kpi">
            <b>{counts.live}</b>
            <span>Links working now</span>
          </div>
          <div className="kpi">
            <b>{counts.opened}</b>
            <span>Advertisers opened it</span>
          </div>
          <div className="kpi">
            <b>{counts.downloads}</b>
            <span>Downloads</span>
          </div>
          <div className={`kpi ${counts.waiting ? 'warn' : ''}`}>
            <b>{counts.waiting}</b>
            <span>Not opened yet</span>
          </div>
        </div>

        <div className="mk-files">
          {book.files.map((f, i) => (
            <article key={f.id} className="mk-file">
              <button className="mk-cover" onClick={() => setReading(f)} aria-label={`Open ${f.title}`}>
                {f.cover ? <img src={f.cover} alt="" width={380} height={538} /> : <span>PDF</span>}
              </button>
              <div className="mk-file-body">
                <strong>{f.title}</strong>
                <span className="meta">
                  {f.pages ? `${f.pages} pages · ` : ''}
                  {sizeOf(f.size)} · updated {day(f.updated_at)}
                </span>
                <div className="mk-file-btns">
                  <button className="btn small" onClick={() => setReading(f)}>
                    Open
                  </button>
                  <button className="btn ghost small mk-wa" onClick={() => setSharing([f.id])}>
                    WhatsApp
                  </button>
                  <RowMenu
                    items={[
                      { label: 'Rename', onClick: () => setRenaming(f) },
                      {
                        label: 'Replace PDF',
                        onClick: () => {
                          replaceFor.current = f
                          replaceInput.current?.click()
                        },
                      },
                      ...(i > 0 ? [{ label: 'Move up', onClick: () => void move(f, 'up') }] : []),
                      ...(i < book.files.length - 1 ? [{ label: 'Move down', onClick: () => void move(f, 'down') }] : []),
                      { label: 'Remove…', danger: true, onClick: () => setRemoving(f) },
                    ]}
                  />
                </div>
              </div>
            </article>
          ))}
          <input
            ref={replaceInput}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              pick(replaceFor.current)(e)
              replaceFor.current = undefined
            }}
          />
          <label className="mk-add">
            <span>＋</span>
            <strong>Add media kit PDF</strong>
            <small>Magazine rates, digital rates, event packages…</small>
            <input type="file" accept="application/pdf,.pdf" hidden onChange={pick()} />
          </label>
        </div>
        {book.files.length > 0 && (
          <div className="action-row">
            <button className="btn ghost small" onClick={() => void preview()}>
              Preview what advertisers see
            </button>
          </div>
        )}
      </Panel>

      <Panel title="Shared links" note="Opens from WhatsApp link previews are not counted, only real visits. You get a notification the first time each advertiser opens it.">
        <div className="chips" role="tablist" aria-label="Show">
          {(
            [
              ['all', 'All'],
              ['opened', 'Opened'],
              ['waiting', 'Not opened'],
              ['ended', 'Expired / stopped'],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="empty">{book.links.length ? 'Nothing here.' : 'No links shared yet. Use “Share media kit” to send one to an advertiser.'}</p>
        ) : (
          <ul className="task-list mk-links">
            {shown.map((l) => {
              const st = statusOf(l, now)
              const ended = !!l.revoked || Date.parse(l.expires_at) < now
              const msg = shareMessage({ person: l.person, company: l.company, url: linkUrl(l.token), expires: l.expires_at }, ownerRole()?.name ?? '')
              return (
                <li key={l.token}>
                  <div>
                    <strong>{l.company}</strong>
                    {l.person && <span className="meta"> · {l.person}</span>}
                    <span className={`emp-status ${st.tone} mk-status`}>{st.label}</span>
                    <span className="meta mk-line">
                      {l.last_open ? `Last seen ${when(l.last_open)} · ` : ''}
                      {titles(l.files)}
                    </span>
                    <span className="meta mk-line">
                      Sent by {l.by_name} on {day(l.created_at)}
                      {ended ? '' : ` · works until ${day(l.expires_at)}`}
                    </span>
                  </div>
                  <div className="task-btns">
                    <button className="mini-btn" onClick={() => setActivity(l)}>
                      Activity
                    </button>
                    {!ended && (
                      <>
                        <a className="mini-btn" href={l.phone ? `https://wa.me/${waNumber(l.phone)}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer">
                          WhatsApp
                        </a>
                        <button className="mini-btn" onClick={() => void navigator.clipboard.writeText(linkUrl(l.token)).then(() => toast('Link copied'))}>
                          Copy link
                        </button>
                      </>
                    )}
                    <button className="mini-btn" onClick={() => void act(l, 'extend')}>
                      +15 days
                    </button>
                    {l.revoked ? (
                      <button className="mini-btn" onClick={() => void act(l, 'restart')}>
                        Start again
                      </button>
                    ) : (
                      !ended && (
                        <button className="mini-btn danger" onClick={() => void act(l, 'stop')}>
                          Stop
                        </button>
                      )
                    )}
                    {ended && (
                      <button className="mini-btn danger" onClick={() => void act(l, 'remove')}>
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <ContactPanel key={JSON.stringify(book.settings)} settings={book.settings} onSaved={res.reload} />

      {adding && (
        <FileDialog
          file={adding.file}
          existing={adding.existing}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null)
            res.reload()
          }}
        />
      )}
      {renaming && (
        <RenameDialog
          file={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => {
            setRenaming(null)
            res.reload()
          }}
        />
      )}
      {sharing && <ShareDialog book={book} only={sharing} onClose={() => setSharing(null)} onSaved={res.reload} />}
      {reading && (
        <KitReader
          file={reading}
          onClose={() => setReading(null)}
          onShare={() => {
            const id = reading.id
            setReading(null)
            setSharing([id])
          }}
        />
      )}
      {removing && (
        <Dialog title="Remove media kit?" onClose={() => setRemoving(null)}>
          <p>
            <b>{removing.title}</b> will be deleted. Advertisers who already have a link will no longer see it. To change the file, use <b>Replace PDF</b> instead.
          </p>
          <div className="action-row">
            <button className="btn ghost" onClick={() => setRemoving(null)} autoFocus>
              Keep it
            </button>
            <button className="btn danger" onClick={() => void remove(removing)}>
              Remove
            </button>
          </div>
        </Dialog>
      )}
      {activity && <ActivityDialog link={activity} files={book.files} onClose={() => setActivity(null)} />}
    </>
  )
}
