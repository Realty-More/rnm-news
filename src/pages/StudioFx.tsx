// Content Studio graphics and motion: numbers that count up when they appear (every tab), small
// SVG charts (area chart with hover, sparkline, bar rows), and the Overview dashboard built on them.
// Motion is skipped when the phone or computer asks for reduced motion.
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { useAsync } from '../lib/hooks.ts'
import { studio } from '../lib/owner.ts'
import { Panel } from './StudioTools.tsx'

const calm = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Counts every KPI number in the Studio up from zero the first time it shows (".kpi b" and
 * [data-count]). Only plain numbers ("978", "1,234", "75%") are animated; the final text is
 * exactly what the page rendered, and it stops if the page changes the number meanwhile.
 */
export function useCountUp(ref: RefObject<HTMLElement | null>, key: unknown) {
  useEffect(() => {
    const root = ref.current
    if (!root || calm()) return
    const run = (el: HTMLElement) => {
      if (el.dataset.counted || el.closest('.tm-kpis')) return
      const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue?.trim()) as Text | undefined
      const m = node ? /^(\s*)(\d[\d,]*)(%?\s*)$/.exec(node.nodeValue ?? '') : null
      if (!node || !m) return
      const target = Number(m[2].replace(/,/g, ''))
      if (!target || target > 1e9) return
      el.dataset.counted = '1'
      const fmt = (v: number) => (m[2].includes(',') ? v.toLocaleString('en-IN') : String(v))
      const t0 = performance.now()
      let last = ''
      const step = (t: number) => {
        if (last && node.nodeValue !== last) return
        const k = Math.min(1, (t - t0) / 900)
        last = m[1] + fmt(Math.round(target * (1 - Math.pow(1 - k, 3)))) + m[3]
        node.nodeValue = last
        if (k < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }
    const scan = () => root.querySelectorAll<HTMLElement>('.kpi b, [data-count]').forEach(run)
    scan()
    const mo = new MutationObserver(scan)
    mo.observe(root, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [ref, key])
}

/** A small line with a soft fill, last point marked. */
export function Spark({ values, color = 'var(--accent)', height = 34 }: { values: number[]; color?: string; height?: number }) {
  const id = useId().replace(/:/g, '')
  if (values.length < 2) return null
  const w = 120
  const max = Math.max(1, ...values)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 3 - (v / max) * (height - 8)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg className="fx-spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`sg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#sg${id})`} />
      <path className="fx-draw" d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="3" fill={color} />
    </svg>
  )
}

interface Series {
  name: string
  color: string
  values: number[]
}

/** Area chart for a few series over days, with gridlines and a hover read-out. */
export function AreaChart({ labels, series, height = 220 }: { labels: string[]; series: Series[]; height?: number }) {
  const id = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const W = 720
  const H = height
  const pad = { l: 40, r: 12, t: 14, b: 26 }
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const nice = Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max)))) * Math.pow(10, Math.floor(Math.log10(max)))
  const x = (i: number) => pad.l + (i / Math.max(1, labels.length - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / nice) * (H - pad.t - pad.b)
  // Gentle curves between points.
  const path = (vals: number[]) =>
    vals
      .map((v, i) => {
        if (!i) return `M${x(0)},${y(v)}`
        const x0 = x(i - 1)
        const x1 = x(i)
        const cx = (x0 + x1) / 2
        return `C${cx},${y(vals[i - 1])} ${cx},${y(v)} ${x1},${y(v)}`
      })
      .join(' ')
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => Math.round(nice * k))
  const onMove = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX
    const rel = ((cx - box.left) / box.width) * W
    const i = Math.round(((rel - pad.l) / (W - pad.l - pad.r)) * (labels.length - 1))
    setHover(Math.max(0, Math.min(labels.length - 1, i)))
  }
  return (
    <div className="fx-area">
      <div className="fx-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} /> {s.name} <b>{s.values.reduce((a, b) => a + b, 0).toLocaleString('en-IN')}</b>
          </span>
        ))}
      </div>
      <div className="fx-area-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${series.map((s) => s.name).join(' and ')} by day`} onMouseMove={onMove} onTouchMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            {series.map((s, k) => (
              <linearGradient key={s.name} id={`ag${id}${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="fx-grid" />
              <text x={pad.l - 8} y={y(t) + 4} className="fx-axis" textAnchor="end">
                {t >= 1000 ? `${Math.round(t / 100) / 10}k` : t}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % Math.ceil(labels.length / 7) === 0 || i === labels.length - 1 ? (
              <text key={l + i} x={x(i)} y={H - 6} className="fx-axis" textAnchor={i === labels.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>
                {l}
              </text>
            ) : null,
          )}
          {series.map((s, k) => (
            <g key={s.name}>
              <path d={`${path(s.values)} L${x(s.values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#ag${id}${k})`} className="fx-fill" />
              <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" className="fx-draw" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} className="fx-cursor" />
              {series.map((s) => (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="5" fill="var(--bg)" stroke={s.color} strokeWidth="2.5" />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="fx-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <b>{labels[hover]}</b>
            {series.map((s) => (
              <span key={s.name}>
                <i style={{ background: s.color }} /> {s.name}: <b>{s.values[hover].toLocaleString('en-IN')}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Ranked rows with a bar behind each value. */
export function BarRows({ rows }: { rows: { label: string; value: number; href?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ol className="fx-bars">
      {rows.map((r, i) => (
        <li key={r.label + i} style={{ '--w': `${(r.value / max) * 100}%`, '--i': i } as React.CSSProperties}>
          <span className="fx-rank">{i + 1}</span>
          <span className="fx-bar-label">
            {r.href ? (
              <a href={r.href} target="_blank" rel="noopener noreferrer">
                {r.label}
              </a>
            ) : (
              r.label
            )}
            <i className="fx-bar" />
          </span>
          <b>{r.value.toLocaleString('en-IN')}</b>
        </li>
      ))}
    </ol>
  )
}

/** Searches as a cloud: bigger and warmer for more searches. */
function Cloud({ items, warn = false }: { items: { q: string; n: number }[]; warn?: boolean }) {
  const max = Math.max(1, ...items.map((s) => s.n))
  return (
    <div className="fx-cloud">
      {items.map((s) => {
        const k = s.n / max
        return (
          <span key={s.q} className={`fx-word ${warn ? 'warn' : ''}`} style={{ fontSize: `${13 + k * 9}px`, '--k': k } as React.CSSProperties}>
            {s.q} <b>{s.n}</b>
          </span>
        )
      })}
    </div>
  )
}

interface Overview {
  subscribers: number
  views7: number
  opens7: number
  topArticles: { id: number; opens: number; title: string; link?: string }[]
  searches: { q: string; n: number }[]
  zeroSearches: { q: string; n: number }[]
  daily?: { day: string; views: number; opens: number }[]
}

const short = (day: string) => new Date(`${day}T06:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

function Delta({ now, before }: { now: number; before: number }) {
  if (!before && !now) return null
  const pct = before ? Math.round(((now - before) / before) * 100) : 100
  const up = now >= before
  return (
    <em className={`fx-delta ${up ? 'up' : 'down'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}% <small>vs previous 7 days</small>
    </em>
  )
}

export function OverviewTab() {
  const res = useAsync('studio:overview', (s) => studio<Overview>('overview', undefined, s))
  const d = res.data
  const daily = useMemo(() => d?.daily ?? [], [d])
  const last7 = daily.slice(-7)
  const prev7 = daily.slice(0, 7)
  const sum = (xs: { views: number; opens: number }[], k: 'views' | 'opens') => xs.reduce((n, x) => n + x[k], 0)
  if (res.error && !d) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!d) return <SkeletonList count={3} />
  return (
    <>
      <div className="kpis fx-kpis">
        <div className="kpi fx-kpi">
          <span className="fx-ico">
            <Icon name="bell" size={18} />
          </span>
          <b>{d.subscribers}</b>
          <span>Alert subscribers</span>
          <small className="fx-kpi-note">Phones that get breaking news</small>
        </div>
        <div className="kpi fx-kpi">
          <span className="fx-ico">
            <Icon name="chart" size={18} />
          </span>
          <b>{d.views7.toLocaleString('en-IN')}</b>
          <span>Screen views · 7 days</span>
          {daily.length > 0 && <Delta now={sum(last7, 'views')} before={sum(prev7, 'views')} />}
          <Spark values={last7.map((x) => x.views)} />
        </div>
        <div className="kpi fx-kpi">
          <span className="fx-ico">
            <Icon name="news" size={18} />
          </span>
          <b>{d.opens7.toLocaleString('en-IN')}</b>
          <span>Stories read · 7 days</span>
          {daily.length > 0 && <Delta now={sum(last7, 'opens')} before={sum(prev7, 'opens')} />}
          <Spark values={last7.map((x) => x.opens)} color="#6fd39b" />
        </div>
      </div>

      {daily.length > 0 && (
        <Panel title="App activity · last 14 days" note="Hover or touch the chart to see a day.">
          <AreaChart
            labels={daily.map((x) => short(x.day))}
            series={[
              { name: 'Screen views', color: '#f5a524', values: daily.map((x) => x.views) },
              { name: 'Stories read', color: '#2e9d5b', values: daily.map((x) => x.opens) },
            ]}
          />
        </Panel>
      )}

      <div className="fx-two">
        <Panel title="Most read in the app · 7 days" note="Write more on topics like these.">
          {d.topArticles.length ? <BarRows rows={d.topArticles.map((a) => ({ label: a.title, value: a.opens, href: a.link }))} /> : <p className="empty">No reads recorded yet.</p>}
        </Panel>
        <div>
          <Panel title="What readers search for · 30 days">{d.searches.length ? <Cloud items={d.searches} /> : <p className="empty">No searches yet.</p>}</Panel>
          <Panel title="Searches with no results · 30 days" note="Readers looked for these and found nothing: strong story ideas.">
            {d.zeroSearches.length ? <Cloud items={d.zeroSearches} warn /> : <p className="empty">None so far.</p>}
          </Panel>
        </div>
      </div>
    </>
  )
}

/** Wraps a tab so it fades in when chosen and its numbers count up. */
export function StudioBody({ tab, children }: { tab: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useCountUp(ref, tab)
  return (
    <div className="studio-body" ref={ref} key={tab}>
      {children}
    </div>
  )
}
