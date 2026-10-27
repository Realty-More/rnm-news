// R&M Magazine: every issue uploaded to realtynmore.com, with its cover, read inside the app.
// The issue list and covers are built from the website every 30 minutes (scripts/magazine.py);
// pages load part by part through the app server, so even large issues open quickly.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { useAsync } from '../lib/hooks.ts'
import { PUSH_API } from '../lib/push.ts'
import { shareLink } from '../lib/share.ts'
import { Capacitor } from '@capacitor/core'
import { LIVE_SITE, loadMagazine, type Issue } from '../lib/magazine.ts'
import { usePageTitle } from './usePageTitle.ts'

export type { Issue } from '../lib/magazine.ts'
export const loadIssues = loadMagazine
const mb = (b: number) => (b ? `${Math.round(b / 1e6)} MB` : '')
const KIND: Record<Issue['kind'], string> = { quarterly: 'Quarterly issue', special: 'Special', archive: 'Archive' }

export function MagazineList() {
  usePageTitle('R&M Magazine')
  const res = useAsync('magazine:issues', (s) => loadIssues(s))
  const years = useMemo(() => {
    const by = new Map<string, Issue[]>()
    for (const i of (res.data ?? []).slice(1)) by.set(i.period.slice(0, 4), [...(by.get(i.period.slice(0, 4)) ?? []), i])
    return [...by]
  }, [res.data])
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data) return <SkeletonList count={3} />
  const latest = res.data[0]
  return (
    <div className="page magazine">
      <div className="page-head">
        <h1>R&amp;M Magazine</h1>
        <p className="page-sub">Every issue of our magazine, free to read in the app.</p>
      </div>
      {latest && (
        <Link to={`/magazine/${latest.id}`} className="mz-hero">
          <img src={latest.cover} alt={`R&M Magazine ${latest.title} cover`} width={560} height={792} />
          <div className="mz-hero-text">
            <span className="kicker">Latest issue</span>
            <h2>{latest.title}</h2>
            <p>
              {latest.pages} pages{latest.bytes ? ` · ${mb(latest.bytes)}` : ''}
            </p>
            <span className="btn">
              <Icon name="news" size={17} /> Read now
            </span>
          </div>
        </Link>
      )}
      {years.map(([year, list]) => (
        <section key={year} className="mz-year" aria-labelledby={`y-${year}`}>
          <h2 id={`y-${year}`} className="mz-year-h">
            {year}
          </h2>
          <div className="mz-grid">
            {list.map((i) => (
              <Link key={i.id} to={`/magazine/${i.id}`} className="mz-issue">
                <img src={i.cover} alt={`R&M Magazine ${i.title} cover`} loading="lazy" width={560} height={792} />
                <strong>{i.title}</strong>
                <span>
                  {KIND[i.kind]} · {i.pages} pages
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy

// Pages are drawn one at a time: overlapping draws of the same page can stall in pdf.js
// (seen when zooming). A draw that takes over 20 s is given up so the queue keeps moving.
let queue: Promise<void> = Promise.resolve()
function drawQueue(job: () => Promise<void>): Promise<void> {
  const run = () => Promise.race([job(), new Promise<void>((r) => setTimeout(r, 20000))]).catch(() => {})
  queue = queue.then(run)
  return queue
}

/** One page: drawn when it comes near the screen, at the current zoom. */
function PdfPage({ doc, n, width, ratio }: { doc: PdfDoc; n: number; width: number; ratio: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(n <= 2)
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '1200px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!near) return
    let dead = false
    void drawQueue(async () => {
      if (dead || !ref.current) return
      const page = await doc.getPage(n)
      const c = ref.current
      if (dead || !c) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const vp = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * dpr })
      c.width = Math.floor(vp.width)
      c.height = Math.floor(vp.height)
      await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
      if (!dead) setDrawn(true)
    })
    return () => {
      dead = true
    }
  }, [near, doc, n, width])
  return (
    <div ref={box} className="pdf-page" style={{ width, height: width * ratio }} data-page={n}>
      <canvas ref={ref} style={{ width: '100%', height: '100%' }} aria-label={`Page ${n}`} />
      {!drawn && <span className="pdf-page-n">{n}</span>}
    </div>
  )
}

export function MagazineReader() {
  const { id } = useParams()
  const navigate = useNavigate()
  const issues = useAsync('magazine:issues', (s) => loadIssues(s))
  const issue = issues.data?.find((i) => String(i.id) === id)
  usePageTitle(issue ? `R&M Magazine ${issue.title}` : 'R&M Magazine')
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [ratio, setRatio] = useState(1.414)
  const [zoom, setZoom] = useState(1)
  const [page, setPage] = useState(1)
  const wrap = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(() => Math.min(window.innerWidth - 24, 900))

  useEffect(() => {
    const on = () => setFit(Math.min(window.innerWidth - 24, 900))
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  useEffect(() => {
    if (!id || !PUSH_API) return
    let cancelled = false
    let loaded: PdfDoc | null = null
    setError(null)
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        pdfjs.GlobalWorkerOptions.workerSrc = worker
        const task = pdfjs.getDocument({ url: `${PUSH_API}/magazine/pdf/${id}`, rangeChunkSize: 1 << 19, disableAutoFetch: true, disableStream: true })
        task.onProgress = (p: { loaded: number; total: number }) => p.total && setProgress(Math.min(99, Math.round((p.loaded / p.total) * 100)))
        const d = await task.promise
        if (cancelled) return void d.destroy()
        loaded = d
        const first = await d.getPage(1)
        const vp = first.getViewport({ scale: 1 })
        setRatio(vp.height / vp.width)
        setDoc(d)
      } catch {
        if (!cancelled) setError(navigator.onLine ? 'Could not open this issue. Please try again.' : 'Connect to the internet to read the magazine.')
      }
    })()
    return () => {
      cancelled = true
      void loaded?.destroy()
      setDoc(null)
    }
  }, [id])

  // Page counter: the page nearest the middle of the screen.
  useEffect(() => {
    if (!doc) return
    const on = () => {
      const pages = wrap.current?.querySelectorAll<HTMLElement>('.pdf-page') ?? []
      const mid = window.innerHeight / 2
      for (const p of pages) {
        const r = p.getBoundingClientRect()
        if (r.top <= mid && r.bottom >= mid) {
          setPage(Number(p.dataset.page))
          break
        }
      }
    }
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [doc])

  const width = Math.round(fit * zoom)
  const share = async () => {
    // Inside the Android app the page address is "localhost", so share the public site instead.
    const home = Capacitor.isNativePlatform() ? LIVE_SITE : `${location.origin}${location.pathname}`
    const ok = await shareLink(`R&M Magazine ${issue?.title ?? ''}`.trim(), `${home}#/magazine/${id}`)
    if (ok === 'copied') toast('Link copied')
  }

  return (
    <div className="page mz-reader">
      <div className="mz-bar">
        <button className="icon-btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/magazine'))} aria-label="Back">
          <Icon name="back" />
        </button>
        <div className="mz-bar-title">
          <strong>{issue ? issue.title : 'R&M Magazine'}</strong>
          <span>{doc ? `Page ${page} of ${doc.numPages}` : error ? '' : `Opening… ${progress ? `${progress}%` : ''}`}</span>
        </div>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))} disabled={zoom <= 1} aria-label="Zoom out">
          −
        </button>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.min(3, +(z + 0.5).toFixed(1)))} disabled={zoom >= 3} aria-label="Zoom in">
          +
        </button>
        <button className="icon-btn" onClick={share} aria-label="Share">
          <Icon name="share" size={20} />
        </button>
        {issue && (
          <a className="icon-btn" href={issue.url} target="_blank" rel="noopener noreferrer" aria-label="Download PDF">
            <Icon name="download" size={20} />
          </a>
        )}
      </div>
      {error ? (
        <ErrorState error={new Error(error)} onRetry={() => navigate(0)} />
      ) : !doc ? (
        <div className="mz-loading">
          {issue && <img src={issue.cover} alt="" />}
          <span className="mz-loading-bar">
            <span style={{ width: `${Math.max(progress, 4)}%` }} />
          </span>
        </div>
      ) : (
        <div ref={wrap} className={`pdf-pages ${zoom > 1 ? 'zoomed' : ''}`}>
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={`${i}-${width}`} doc={doc} n={i + 1} width={width} ratio={ratio} />
          ))}
        </div>
      )}
    </div>
  )
}
