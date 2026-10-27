// Studio → Content → Press release: upload a raw press release (Word, PDF or text) and get a story in
// the desk's house style (Arun sir's format), ready to paste into WordPress. Every result is kept as a
// draft so the desk can open it later.
import { useState, type ChangeEvent } from 'react'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDateTime } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { studio, studioPost } from '../lib/owner.ts'
import { Panel } from './StudioTools.tsx'

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

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')

/** Paragraph text of a Word document's XML. */
export function docxXmlToText(xml: string): string {
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []
  return paras
    .map((p) => decodeXml((p.replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>/g, '\n').match(/<w:t[^>]*>[\s\S]*?<\/w:t>|\n/g) ?? []).map((t) => (t === '\n' ? '\n' : t.replace(/<[^>]+>/g, ''))).join('')).trim())
    .filter(Boolean)
    .join('\n')
}

/** Text of a .docx file, read in the browser (a .docx is a zip; the text is word/document.xml). */
async function docxText(buf: ArrayBuffer): Promise<string> {
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
  for (let n = 0; n < count; n++) {
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extra = v.getUint16(p + 30, true)
    const comment = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen))
    if (name === 'word/document.xml') {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
      const data = new Uint8Array(buf, start, size)
      const xml = method === 0 ? new TextDecoder().decode(data) : await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
      return docxXmlToText(xml)
    }
    p += 46 + nameLen + extra + comment
  }
  throw new Error('No text found in this Word file.')
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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>')

/** Copies rich text (keeps bold and italics when pasted into WordPress), with plain text as a fallback. */
async function copyRich(html: string, text: string) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

function StoryView({ s, onRemove }: { s: Story; onRemove?: () => void }) {
  const [pick, setPick] = useState(0)
  const headline = s.headlines[pick] ?? ''
  const full = `<h1>${esc(headline)}</h1>\n${s.html}`
  return (
    <div className="pr-story">
      {s.warnings.length > 0 && (
        <div className="pr-warn" role="alert">
          {s.warnings.map((w) => (
            <p key={w}>⚠ {w}</p>
          ))}
        </div>
      )}
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
        {s.paragraphs.map((p, i) => (
          <p key={i} dangerouslySetInnerHTML={{ __html: inline(p) }} />
        ))}
      </article>
      <div className="action-row">
        <button className="btn small" onClick={() => void copyRich(s.html, s.text).then(() => toast('Story copied: paste it into WordPress'))}>
          Copy story for WordPress
        </button>
        <button className="btn ghost small" onClick={() => void navigator.clipboard.writeText(headline).then(() => toast('Headline copied'))}>
          Copy headline
        </button>
        <button
          className="btn ghost small"
          onClick={() => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([`<html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial">${full}</body></html>`], { type: 'application/msword' }))
            a.download = `${s.slug || 'story'}.doc`
            a.click()
            setTimeout(() => URL.revokeObjectURL(a.href), 1000)
          }}
        >
          Download Word
        </button>
        {onRemove && (
          <button className="btn ghost small" onClick={onRemove}>
            Delete draft
          </button>
        )}
      </div>
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

export function PressTab() {
  const drafts = useAsync('studio:press-drafts', (s) => studio<{ drafts: Draft[] }>('press/drafts', undefined, s))
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState<'' | 'read' | 'write'>('')
  const [story, setStory] = useState<Story | null>(null)

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy('read')
    try {
      const buf = await f.arrayBuffer()
      const name = f.name.toLowerCase()
      const t = name.endsWith('.docx') ? await docxText(buf) : name.endsWith('.pdf') ? await pdfText(buf) : new TextDecoder().decode(buf)
      if (t.trim().length < 100) throw new Error('Could not find much text in this file. Try copying the text and pasting it.')
      setText(t.trim())
      setSource(f.name)
      setStory(null)
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy('')
    }
  }
  const write = async () => {
    setBusy('write')
    try {
      const s = await studioPost<Story>('press/story', { text, source: source || 'Pasted text' })
      setStory(s)
      drafts.reload()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy('')
    }
  }
  const open = async (id: number) => {
    try {
      setStory(await studio<Story>(`press/draft?id=${id}`))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      toast((err as Error).message)
    }
  }
  const remove = async (id: number) => {
    if (!window.confirm('Delete this draft?')) return
    await studioPost('press/remove', { id }).catch((err) => toast((err as Error).message))
    if (story?.id === id) setStory(null)
    drafts.reload()
  }

  return (
    <>
      <Panel title="Press release → R&M story" note="Upload the press release Palash sir sends (Word, PDF or text) or paste it. You get a story in the desk format: new headline, bold dateline, “according to a company press release”, short paragraphs, the quote word for word with bold name and company. Always read it once before publishing.">
        <div className="pr-input">
          <label className="btn ghost small pr-file">
            {busy === 'read' ? 'Reading…' : '📄 Upload Word / PDF'}
            <input type="file" accept=".docx,.pdf,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden onChange={(e) => void onFile(e)} />
          </label>
          {source && <span className="meta">{source}</span>}
        </div>
        <textarea
          className="pr-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (!source) setSource('Pasted text')
          }}
          rows={10}
          placeholder="…or paste the press release here"
          aria-label="Press release text"
        />
        <div className="action-row">
          <button className="btn" disabled={!!busy || text.trim().length < 200} onClick={() => void write()}>
            {busy === 'write' ? 'Writing the story… (about 20 seconds)' : '✨ Write R&M story'}
          </button>
          {text && (
            <button
              className="btn ghost small"
              onClick={() => {
                setText('')
                setSource('')
                setStory(null)
              }}
            >
              Clear
            </button>
          )}
        </div>
      </Panel>

      {story && (
        <Panel title={story.byName ? `Draft by ${story.byName}` : 'Your story'} note={story.created ? `From ${story.source} · ${formatDateTime(story.created)}` : undefined}>
          <StoryView key={story.id ?? story.slug} s={story} onRemove={story.id ? () => void remove(story.id!) : undefined} />
        </Panel>
      )}

      <Panel title="Recent drafts" note="Every story made here is kept, so anyone on the desk can open it.">
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
