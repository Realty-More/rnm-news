// Studio → Content → Press release: drop in everything Palash sir sends (one or more press releases as
// Word, PDF or text, plus photos) and get each story in the desk's house style (Arun sir's format),
// laid out the way realtynmore.com shows it: featured image on top, small headshots beside the person's
// quote (left, then right), the author's photo beside the byline of a guest column. Photos found inside
// the Word file are used too (logos are left out). Every result is kept as a draft with its photos.
import { useEffect, useState, type ChangeEvent, type DragEvent } from 'react'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDateTime } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { ownerKey, studio, studioPost } from '../lib/owner.ts'
import { PUSH_API } from '../lib/push.ts'
import { Panel } from './StudioTools.tsx'

type Kind = 'news' | 'leadership' | 'report' | 'launch' | 'rera' | 'event' | 'guest'
type Role = 'featured' | 'photo' | 'headshot' | 'skip'
interface Person {
  name: string
  designation: string
  company: string
  role: 'author' | 'appointee' | 'speaker'
}
interface Story {
  id?: number
  headlines: string[]
  dateline: string
  paragraphs: string[]
  html: string
  text: string
  tags: string[]
  meta: string
  slug: string
  warnings: string[]
  kind: Kind
  category: string
  people: Person[]
  images?: { n: number; role: Role; person: string; name: string; type: string; w: number; h: number }[]
  source?: string
  byName?: string
  created?: string
}
interface Draft {
  id: number
  title: string
  source: string
  byName: string
  created: string
}
/** A photo in the browser: the file (already resized to JPEG), its size and where it goes. */
interface Img {
  key: string
  blob: Blob
  url: string
  name: string
  w: number
  h: number
  role: Role
  person: string
  n?: number
}
interface Doc {
  name: string
  text: string
  images: Img[]
}
interface Result {
  story: Story
  images: Img[]
  from: string
}

const KINDS: [Kind | 'auto', string][] = [
  ['auto', 'Find it automatically'],
  ['news', 'News'],
  ['leadership', 'Leadership Updates (appointment)'],
  ['report', 'Report / survey'],
  ['launch', 'New Launches'],
  ['rera', 'RERA'],
  ['event', 'Events'],
  ['guest', 'Guest Column (expert’s article)'],
]
const ROLES: [Role, string][] = [
  ['featured', 'Featured image (top)'],
  ['headshot', 'Headshot'],
  ['photo', 'Photo in the story'],
  ['skip', 'Don’t use'],
]
const SERVER = PUSH_API.replace(/\/$/, '')

/* ---------- reading files ---------- */

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')

/** Paragraph text of a Word document's XML. */
export function docxXmlToText(xml: string): string {
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []
  return paras
    .map((p) => decodeXml((p.replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>/g, '\n').match(/<w:t[^>]*>[\s\S]*?<\/w:t>|\n/g) ?? []).map((t) => (t === '\n' ? '\n' : t.replace(/<[^>]+>/g, ''))).join('')).trim())
    .filter(Boolean)
    .join('\n')
}

/** Files inside a zip (a .docx is a zip), read with the browser's own decompression. */
async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<{ name: string; data: Uint8Array }[]> {
  const v = new DataView(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) throw new Error('This does not look like a Word (.docx) file.')
  let p = v.getUint32(eocd + 16, true)
  const count = v.getUint16(eocd + 10, true)
  const out: { name: string; data: Uint8Array }[] = []
  for (let n = 0; n < count; n++) {
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extra = v.getUint16(p + 30, true)
    const comment = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen))
    if (want(name)) {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
      const raw = new Uint8Array(buf, start, size)
      const data = method === 0 ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
      out.push({ name, data })
    }
    p += 46 + nameLen + extra + comment
  }
  return out
}

/** Text of the first pages of a PDF (with pdf.js, loaded only when needed). */
async function pdfText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  const out: string[] = []
  for (let i = 1; i <= Math.min(doc.numPages, 8); i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    out.push(tc.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join(''))
  }
  await doc.destroy()
  return out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
}

let keySeq = 0
/** A photo made ready for the web: at most 1600 px wide, JPEG on white (logos with transparency stay clean). */
async function toImg(blob: Blob, name: string): Promise<Img | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const ow = bmp.width
    const oh = bmp.height
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.86))
    if (!out) return null
    // Logos and icons: small, or a wide strip, or a tiny file.
    const logo = (ow < 260 && oh < 260) || w / h > 2.4 || blob.size < 9000
    return { key: `i${++keySeq}`, blob: out, url: URL.createObjectURL(out), name, w: ow, h: oh, role: logo ? 'skip' : 'photo', person: '' }
  } catch {
    return null
  }
}

async function readDoc(f: File): Promise<Doc> {
  const buf = await f.arrayBuffer()
  const name = f.name.toLowerCase()
  if (name.endsWith('.docx')) {
    const parts = await unzip(buf, (n) => n === 'word/document.xml' || /^word\/media\/.+\.(png|jpe?g|webp|gif)$/i.test(n))
    const xml = parts.find((p) => p.name === 'word/document.xml')
    if (!xml) throw new Error(`No text found in ${f.name}.`)
    const images = (await Promise.all(parts.filter((p) => p !== xml).map((p) => toImg(new Blob([p.data as BlobPart]), `${f.name} · ${p.name.split('/').pop()}`)))).filter((x): x is Img => !!x)
    return { name: f.name, text: docxXmlToText(new TextDecoder().decode(xml.data)), images }
  }
  if (name.endsWith('.pdf')) return { name: f.name, text: await pdfText(buf), images: [] }
  return { name: f.name, text: new TextDecoder().decode(buf), images: [] }
}

/* ---------- photos: who is in which photo, and where it goes ---------- */

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.[a-z]{3,4}$/, '')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !['image', 'photo', 'final', 'copy', 'img', 'jpeg', 'png', 'docx', 'profile', 'pic', 'picture', 'press', 'release', 'headshot'].includes(w))
/** Does a file name mention this person (first or last name)? */
const mentions = (file: string, p: Person) => {
  const fw = words(file)
  return words(p.name).some((w) => fw.includes(w))
}

/** First guess at each photo's place, from its shape, its file name and the people in the story. */
export function guessRoles(imgs: Img[], s: Story): Img[] {
  const out = imgs.map((i) => ({ ...i }))
  const usable = out.filter((i) => i.role !== 'skip')
  const people = s.people
  const taken = new Set<string>()
  // Headshots: portrait or square photos; by file name first, then in the order people appear.
  const portraits = usable.filter((i) => i.w / i.h <= 1.25)
  for (const img of portraits) {
    const p = people.find((x) => !taken.has(x.name) && mentions(img.name, x))
    if (p) {
      img.role = 'headshot'
      img.person = p.name
      taken.add(p.name)
    }
  }
  for (const img of portraits.filter((i) => !i.person)) {
    const p = people.find((x) => !taken.has(x.name))
    if (!p) break
    img.role = 'headshot'
    img.person = p.name
    taken.add(p.name)
  }
  // The widest landscape photo is the featured image; other photos go inside the story.
  const wide = usable.filter((i) => i.role !== 'headshot').sort((a, b) => b.w / b.h - a.w / a.h || b.w - a.w)
  wide.forEach((img, k) => (img.role = k === 0 && img.w / img.h > 1.1 ? 'featured' : 'photo'))
  return out
}

interface Fig {
  img: Img
  align: 'left' | 'right'
  width: string
}
/** Where photos go, the way realtynmore.com lays them out: before which paragraph, which side, how wide. */
export function layout(s: Story, imgs: Img[]): Map<number, Fig[]> {
  const n = s.paragraphs.length
  const spots: { i: number; img: Img; width: string }[] = []
  const add = (i: number, img: Img, width: string) => spots.push({ i: Math.max(0, Math.min(n - 1, i)), img, width })
  for (const img of imgs.filter((i) => i.role === 'headshot')) {
    const p = s.people.find((x) => x.name === img.person)
    if (!p || p.role === 'author' || s.kind === 'guest') {
      add(0, img, '111px')
      continue
    }
    const last = p.name.split(' ').pop() ?? p.name
    const hits = s.paragraphs.map((t, i) => ({ t, i })).filter(({ t, i }) => i > 0 && (t.includes(p.name) || t.includes(last)))
    // A spokesperson's photo sits by their quote; a new appointee's by the paragraph about them.
    const quote = hits.find(({ t }) => /[“"]/.test(t))
    add((p.role === 'speaker' ? (quote ?? hits[0]) : hits[0])?.i ?? 1, img, '111px')
  }
  imgs.filter((i) => i.role === 'photo').forEach((img, k) => add(Math.max(1, Math.floor(n / 2) + k), img, '42%'))
  // Top to bottom, the photos take turns: left, right, left…
  const at = new Map<number, Fig[]>()
  spots
    .sort((a, b) => a.i - b.i)
    .forEach((x, k) => at.set(x.i, [...(at.get(x.i) ?? []), { img: x.img, align: k % 2 === 0 ? 'left' : 'right', width: x.width }]))
  return at
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70)
/** File names the desk can upload straight to WordPress. */
function fileNames(s: Story, imgs: Img[]): Map<string, string> {
  const names = new Map<string, string>()
  const used = new Set<string>()
  let photo = 0
  for (const i of imgs) {
    if (i.role === 'skip') continue
    const p = s.people.find((x) => x.name === i.person)
    let base = i.role === 'featured' ? s.slug || 'featured' : i.role === 'headshot' && p ? slugify([p.name, p.company].filter(Boolean).join(' ')) : `${s.slug || 'story'}-photo-${++photo}`
    while (used.has(base)) base += '-2'
    used.add(base)
    names.set(i.key, `${base}.jpg`)
  }
  return names
}

/* ---------- a zip of the photos (no compression; JPEGs are already small) ---------- */

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (d: Uint8Array) => {
  let c = 0xffffffff
  for (const b of d) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
async function zip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer())
    const name = new TextEncoder().encode(f.name)
    const crc = crc32(data)
    const head = new DataView(new ArrayBuffer(30))
    ;[[0, 0x04034b50, 4], [4, 20, 2], [8, 0, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2]].forEach(([o, v, s]) => (s === 4 ? head.setUint32(o, v, true) : head.setUint16(o, v, true)))
    const cen = new DataView(new ArrayBuffer(46))
    ;[[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [42, offset, 4]].forEach(([o, v, s]) => (s === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true)))
    parts.push(head.buffer, name, data)
    central.push(new Uint8Array(cen.buffer), name)
    offset += 30 + name.length + data.length
  }
  const size = central.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  ;[[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4]].forEach(([o, v, s]) => (s === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)))
  return new Blob([...parts, ...(central as BlobPart[]), end.buffer], { type: 'application/zip' })
}

function save(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/* ---------- talking to the server ---------- */

async function uploadImages(draft: number, imgs: Img[]): Promise<Img[]> {
  const out: Img[] = []
  for (const [k, img] of imgs.slice(0, 12).entries()) {
    const n = k + 1
    const q = new URLSearchParams({ draft: String(draft), n: String(n), role: img.role, person: img.person, name: img.name, w: String(img.w), h: String(img.h) })
    const r = await fetch(`${SERVER}/editor/press/image?${q}`, { method: 'POST', headers: { Authorization: `Bearer ${ownerKey() ?? ''}`, 'Content-Type': 'image/jpeg' }, body: img.blob }).catch(() => null)
    out.push(r?.ok ? { ...img, n } : img)
  }
  return out
}

async function loadImages(s: Story): Promise<Img[]> {
  const list = s.images ?? []
  const imgs = await Promise.all(
    list.map(async (m) => {
      const r = await fetch(`${SERVER}/editor/press/image?draft=${s.id}&n=${m.n}`, { headers: { Authorization: `Bearer ${ownerKey() ?? ''}` } }).catch(() => null)
      if (!r?.ok) return null
      const blob = await r.blob()
      return { key: `d${s.id}-${m.n}`, blob, url: URL.createObjectURL(blob), name: m.name, w: m.w, h: m.h, role: m.role, person: m.person, n: m.n } as Img
    }),
  )
  return imgs.filter((x): x is Img => !!x)
}

/* ---------- showing a story ---------- */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
const plainText = (s: string) => s.replace(/\*+([^*]+)\*+/g, '$1')

/** Copies rich text (keeps bold and italics when pasted into WordPress), with plain text as a fallback. */
async function copyRich(html: string, text: string) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

function StoryView({ r, onImages, onRemove }: { r: Result; onImages: (imgs: Img[]) => void; onRemove?: () => void }) {
  const s = r.story
  const [pick, setPick] = useState(0)
  const headline = s.headlines[pick] ?? ''
  const imgs = r.images
  const figs = layout(s, imgs)
  const featured = imgs.find((i) => i.role === 'featured')
  const names = fileNames(s, imgs)
  const usable = imgs.filter((i) => i.role !== 'skip')
  const full = `<h1>${esc(headline)}</h1>\n${s.html}`
  const where = (img: Img) => {
    if (img.role === 'featured') return 'WordPress → Featured image'
    if (img.role === 'skip') return 'Not used'
    for (const [i, list] of figs) {
      const f = list.find((x) => x.img.key === img.key)
      if (f) return `Image block above paragraph ${i + 1} (“${plainText(s.paragraphs[i]).slice(0, 38)}…”), align ${f.align}, width ${f.width === '42%' ? '300 px' : '110 px'}`
    }
    return ''
  }
  const change = (img: Img, role: Role, person = img.person) => {
    const next = imgs.map((i) => (i.key === img.key ? { ...i, role, person: role === 'headshot' ? person || s.people[0]?.name || '' : '' } : i))
    onImages(next)
    if (s.id && img.n) void studioPost('press/image-role', { draft: s.id, n: img.n, role, person: role === 'headshot' ? person : '' }).catch(() => {})
  }
  return (
    <div className="pr-story">
      {s.warnings.length > 0 && (
        <div className="pr-warn" role="alert">
          {s.warnings.map((w) => (
            <p key={w}>⚠ {w}</p>
          ))}
        </div>
      )}
      <p className="pr-cat">
        Category in WordPress: <b>{s.category}</b>
        {s.kind === 'guest' && <span> · the author’s text is kept as written</span>}
      </p>
      <span className="dateline">Headline: pick one</span>
      <div className="pr-heads" role="radiogroup" aria-label="Headline">
        {s.headlines.map((h, i) => (
          <label key={h} className={i === pick ? 'on' : ''}>
            <input type="radio" checked={i === pick} onChange={() => setPick(i)} /> {h}
            <small>{h.length} characters</small>
          </label>
        ))}
      </div>
      <article className="pr-preview">
        <h2>{headline}</h2>
        {featured && (
          <figure className="pr-featured">
            <img src={featured.url} alt="" />
            <figcaption>Featured image</figcaption>
          </figure>
        )}
        {s.paragraphs.map((p, i) => (
          <div key={i} className="pr-para">
            {(figs.get(i) ?? []).map((f) => (
              <figure key={f.img.key} className={`pr-fig ${f.align}`} style={{ width: f.width }}>
                <img src={f.img.url} alt={f.img.person} />
              </figure>
            ))}
            <p dangerouslySetInnerHTML={{ __html: inline(p) }} />
          </div>
        ))}
        <div className="pr-clear" />
      </article>
      <div className="action-row">
        <button className="btn small" onClick={() => void copyRich(s.html, s.text).then(() => toast('Story copied: paste it into WordPress'))}>
          Copy story for WordPress
        </button>
        <button className="btn ghost small" onClick={() => void navigator.clipboard.writeText(headline).then(() => toast('Headline copied'))}>
          Copy headline
        </button>
        {usable.length > 0 && (
          <button className="btn ghost small" onClick={() => void zip(usable.map((i) => ({ name: names.get(i.key)!, blob: i.blob }))).then((z) => save(z, `${s.slug || 'story'}-photos.zip`))}>
            Download photos ({usable.length})
          </button>
        )}
        <button className="btn ghost small" onClick={() => save(new Blob([`<html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial">${full}</body></html>`], { type: 'application/msword' }), `${s.slug || 'story'}.doc`)}>
          Download Word
        </button>
        {onRemove && (
          <button className="btn ghost small" onClick={onRemove}>
            Delete draft
          </button>
        )}
      </div>
      {imgs.length > 0 && (
        <div className="pr-photos">
          <h3>Photos · where each one goes</h3>
          <ul>
            {imgs.map((img) => (
              <li key={img.key} className={img.role === 'skip' ? 'off' : ''}>
                <img src={img.url} alt="" />
                <div>
                  <span className="pr-photo-row">
                    <select value={img.role} onChange={(e) => change(img, e.target.value as Role)} aria-label="Use this photo as">
                      {ROLES.map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {img.role === 'headshot' && s.people.length > 0 && (
                      <select value={img.person} onChange={(e) => change(img, 'headshot', e.target.value)} aria-label="Whose photo">
                        {s.people.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name}
                            {p.role === 'author' ? ' (author)' : p.role === 'appointee' ? ' (appointed)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                  <small>
                    {where(img)}
                    {names.get(img.key) ? ` · file: ${names.get(img.key)}` : ''}
                  </small>
                  <small className="meta">
                    {img.name} · {img.w}×{img.h}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="pr-extra">
        <dt>Tags</dt>
        <dd>{s.tags.join(', ') || '–'}</dd>
        <dt>SEO description</dt>
        <dd>
          {s.meta || '–'} {s.meta && <small>({s.meta.length} characters)</small>}
        </dd>
        <dt>Slug</dt>
        <dd>{s.slug || '–'}</dd>
      </dl>
    </div>
  )
}

/* ---------- the tab ---------- */

export function PressTab() {
  const drafts = useAsync('studio:press-drafts', (s) => studio<{ drafts: Draft[] }>('press/drafts', undefined, s))
  const [docs, setDocs] = useState<Doc[]>([])
  const [photos, setPhotos] = useState<Img[]>([])
  const [text, setText] = useState('')
  const [kind, setKind] = useState<Kind | 'auto'>('auto')
  const [busy, setBusy] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [drag, setDrag] = useState(false)

  useEffect(() => () => [...photos, ...docs.flatMap((d) => d.images)].forEach((i) => URL.revokeObjectURL(i.url)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async (files: File[]) => {
    if (!files.length) return
    setBusy('Reading the files…')
    const newDocs: Doc[] = []
    const newPhotos: Img[] = []
    for (const f of files) {
      try {
        if (/^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)) {
          if (f.size > 25 * 1024 * 1024) throw new Error(`${f.name} is too big.`)
          const img = await toImg(f, f.name)
          if (img) newPhotos.push({ ...img, role: img.role === 'skip' && f.size > 60000 ? 'photo' : img.role })
          else throw new Error(`${f.name} could not be opened as a photo.`)
        } else if (/\.(docx|pdf|txt)$/i.test(f.name)) {
          const d = await readDoc(f)
          if (d.text.trim().length < 100) throw new Error(`Could not find much text in ${f.name}. Try copying the text and pasting it.`)
          newDocs.push(d)
        } else throw new Error(`${f.name}: use Word (.docx), PDF, text or photos. Old .doc files: open in Word and “Save as” .docx.`)
      } catch (err) {
        toast((err as Error).message)
      }
    }
    setDocs((d) => [...d, ...newDocs])
    setPhotos((p) => [...p, ...newPhotos])
    setResults([])
    setBusy('')
  }
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    void addFiles(files)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    void addFiles([...e.dataTransfer.files])
  }

  const sources: { name: string; text: string; images: Img[] }[] = text.trim().length >= 200 ? [...docs, { name: 'Pasted text', text: text.trim(), images: [] }] : docs

  const write = async () => {
    const made: Result[] = []
    try {
      for (const [k, d] of sources.entries()) {
        setBusy(sources.length > 1 ? `Writing story ${k + 1} of ${sources.length}… (about 20 seconds each)` : 'Writing the story… (about 20 seconds)')
        const story = await studioPost<Story>('press/story', { text: d.text, source: d.name, kind: kind === 'auto' ? undefined : kind })
        made.push({ story, images: [...d.images], from: d.name })
      }
      // Separate photos go to the story whose people or company the file name mentions; else the first story.
      for (const p of photos) {
        const target = made.find((m) => m.story.people.some((x) => mentions(p.name, x)) || words(p.name).some((w) => words(m.from).includes(w) && w.length > 3)) ?? made[0]
        target?.images.push(p)
      }
      setBusy('Saving the photos…')
      for (const m of made) {
        m.images = guessRoles(m.images, m.story)
        if (m.story.id && m.images.length) m.images = await uploadImages(m.story.id, m.images)
      }
      setResults(made)
      drafts.reload()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      if (made.length) setResults(made)
      toast((err as Error).message)
    } finally {
      setBusy('')
    }
  }
  const clear = () => {
    setDocs([])
    setPhotos([])
    setText('')
    setResults([])
  }
  const open = async (id: number) => {
    try {
      const story = await studio<Story>(`press/draft?id=${id}`)
      setResults([{ story, images: await loadImages(story), from: story.source ?? '' }])
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      toast((err as Error).message)
    }
  }
  const remove = async (id: number) => {
    if (!window.confirm('Delete this draft and its photos?')) return
    await studioPost('press/remove', { id }).catch((err) => toast((err as Error).message))
    setResults((r) => r.filter((x) => x.story.id !== id))
    drafts.reload()
  }

  const count = sources.length
  return (
    <>
      <Panel
        title="Story desk: files → R&M story"
        note="Drop in whatever Palash sir sends: press releases, guest articles, appointment news, reports or event notes (Word, PDF or text), with the photos. Each file becomes its own story in the desk format, with the right category, and photos placed the way realtynmore.com shows them. Always read it once before publishing."
      >
        <label className={`pr-drop ${drag ? 'on' : ''}`} onDragOver={(e) => (e.preventDefault(), setDrag(true))} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
          <input type="file" multiple accept=".docx,.pdf,.txt,image/jpeg,image/png,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden onChange={onPick} />
          <strong>{busy === 'Reading the files…' ? 'Reading…' : '📄 Add files'}</strong>
          <span>Word, PDF, text and photos · pick several at once, or drag them here</span>
        </label>
        {(docs.length > 0 || photos.length > 0) && (
          <div className="pr-files">
            {docs.map((d, i) => (
              <span key={`${d.name}-${i}`} className="pr-chip">
                📄 {d.name}
                {d.images.filter((x) => x.role !== 'skip').length > 0 && ` · ${d.images.filter((x) => x.role !== 'skip').length} photo(s) inside`}
                <button aria-label={`Remove ${d.name}`} onClick={() => setDocs((v) => v.filter((_, k) => k !== i))}>
                  ✕
                </button>
              </span>
            ))}
            {photos.map((p) => (
              <span key={p.key} className="pr-chip pr-chip-img">
                <img src={p.url} alt="" />
                {p.name}
                <button aria-label={`Remove ${p.name}`} onClick={() => setPhotos((v) => v.filter((x) => x.key !== p.key))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea className="pr-text" style={docs.length || photos.length ? { minHeight: 76 } : undefined} value={text} onChange={(e) => setText(e.target.value)} rows={docs.length ? 3 : 8} placeholder="…or paste the text here (press release, article, any news)" aria-label="Story text" />
        <div className="pr-opts">
          <label>
            Story type
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind | 'auto')}>
              {KINDS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="action-row">
          <button className="btn" disabled={!!busy || count === 0} onClick={() => void write()}>
            {busy && busy !== 'Reading the files…' ? busy : count > 1 ? `✨ Write ${count} R&M stories` : '✨ Write R&M story'}
          </button>
          {(docs.length > 0 || photos.length > 0 || text) && (
            <button className="btn ghost small" onClick={clear} disabled={!!busy}>
              Clear
            </button>
          )}
        </div>
      </Panel>

      {results.map((r, k) => (
        <Panel key={r.story.id ?? k} title={results.length > 1 ? `Story ${k + 1} of ${results.length}` : r.story.byName ? `Draft by ${r.story.byName}` : 'Your story'} note={`From ${r.from || r.story.source || 'pasted text'}${r.story.created ? ` · ${formatDateTime(r.story.created)}` : ''}`}>
          <StoryView
            key={r.story.id ?? r.story.slug}
            r={r}
            onImages={(imgs) => setResults((all) => all.map((x) => (x === r ? { ...x, images: imgs } : x)))}
            onRemove={r.story.id ? () => void remove(r.story.id!) : undefined}
          />
        </Panel>
      ))}

      <Panel title="Recent drafts" note="Every story made here is kept with its photos, so anyone on the desk can open it later.">
        {drafts.error && !drafts.data ? (
          <ErrorState error={drafts.error} onRetry={drafts.reload} />
        ) : !drafts.data ? (
          <SkeletonList count={2} />
        ) : drafts.data.drafts.length === 0 ? (
          <p className="empty">No drafts yet.</p>
        ) : (
          <ul className="task-list">
            {drafts.data.drafts.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>{d.title}</strong>
                  <span className="meta">
                    {' '}
                    · {d.source} · {d.byName} · {formatDateTime(d.created)}
                  </span>
                </div>
                <div className="task-btns">
                  <button className="mini-btn" onClick={() => void open(d.id)}>
                    Open
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
