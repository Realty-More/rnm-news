// "Reel scripts" in the Content Studio: the daily and weekly market-close voiceover, written from
// NSE's official closes and our own stories, plus the reference files the team uploads each week.
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDateTime } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { hasFullAccess, ownerKey, studio, studioPost } from '../lib/owner.ts'
import { PUSH_API } from '../lib/push.ts'
import { clock, dailyScript, pctChange, scriptDoc, signed, timeline, weeklyScript, weeklyTables, type Daily, type Scene, type Script, type Weekly } from '../lib/reelScript.ts'
import { Panel } from './StudioTools.tsx'

type DailyRes = Partial<Daily> & { days: string[]; day: string | null }
type WeeklyRes = Partial<Weekly> & { days: string[]; weeks: string[]; week: string | null; ready?: boolean }
interface Ref { id: string; name: string; type: string; size: number; week: string; kind: string; note: string | null; byName: string; at: string }
interface MoverNews { stocks: { symbol: string; name: string; news: { title: string; link: string; source: string; date: string }[] }[] }

const fmtDay = (d: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00Z`))
const n2 = (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

function download(name: string, html: string) {
  const blob = new Blob(['﻿', html], { type: 'application/msword' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Editable scenes: the generated wording is a draft the editor can polish before recording. */
function SceneEditor({ script, onChange }: { script: Script; onChange: (s: Scene[]) => void }) {
  const tl = timeline(script.scenes)
  const words = script.scenes.reduce((a, s) => a + s.vo.split(/\s+/).filter(Boolean).length, 0)
  const set = (i: number, patch: Partial<Scene>) => onChange(script.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  return (
    <div className="reel-script">
      <p className="panel-note">
        {words} words · about {tl[tl.length - 1]?.to ?? 0} seconds. Edit any line before recording; the Word file uses your edits.
      </p>
      <ol className="reel-scenes">
        {script.scenes.map((s, i) => (
          <li key={i}>
            <div className="reel-scene-head">
              <strong>
                {i + 1} · {s.scene}
              </strong>
              <span>
                {clock(tl[i].from)}–{clock(tl[i].to)}
              </span>
              <button className="icon-btn" onClick={() => onChange(script.scenes.filter((_, j) => j !== i))} aria-label={`Remove scene ${i + 1}`}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <textarea value={s.vo} onChange={(e) => set(i, { vo: e.target.value })} rows={Math.max(3, Math.ceil(s.vo.length / 38))} aria-label={`Voiceover ${i + 1}`} />
            <input value={s.screen} onChange={(e) => set(i, { screen: e.target.value })} aria-label={`On-screen text ${i + 1}`} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function ScriptActions({ script, fileName, tables }: { script: Script; fileName: string; tables: Parameters<typeof scriptDoc>[1] }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script.scenes.map((s) => s.vo).join('\n\n'))
      toast('Voiceover copied')
    } catch {
      toast('Copy is blocked here; use the Word file')
    }
  }
  return (
    <div className="action-row">
      <button className="btn" onClick={copy}>
        Copy voiceover
      </button>
      <button className="btn ghost" onClick={() => download(fileName, scriptDoc(script, tables))}>
        <Icon name="download" size={16} /> Word file
      </button>
    </div>
  )
}

function useEdited(base: Script | null) {
  const [scenes, setScenes] = useState<Scene[] | null>(null)
  useEffect(() => setScenes(null), [base])
  return { script: base && { ...base, scenes: scenes ?? base.scenes }, setScenes }
}

function DailyView() {
  const [day, setDay] = useState<string | null>(null)
  const res = useAsync(`studio:reel-daily:${day ?? 'latest'}`, (s) => studio<DailyRes>(`reels/daily${day ? `?day=${day}` : ''}`, undefined, s))
  const d = res.data
  const base = useMemo(() => {
    if (!d?.day || !d.indices) return null
    try {
      return dailyScript(d as Daily)
    } catch {
      return null
    }
  }, [d])
  const { script, setScenes } = useEdited(base)
  if (res.error && !d) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!d) return <SkeletonList count={3} />
  if (!d.day) return <NoData />
  const idx = d.indices?.find((i) => i.name === 'Nifty Realty')
  const cons = (d.stocks ?? []).filter((s) => s.index).map((s) => ({ ...s, pct: pctChange(s.prev, s.close) })).sort((a, b) => a.pct - b.pct)
  const tables = [
    { title: 'Market snapshot', head: ['Indicator', 'Close', 'Change'], rows: (d.indices ?? []).map((i) => [i.name, n2(i.close), `${n2(i.pts)} pts  |  ${signed(i.pct ?? 0)}`]) },
    { title: 'Nifty Realty constituents (decliners first)', head: ['Rank / Company', 'Close (₹)', 'Prev close (₹)', 'Change'], rows: cons.map((s, i) => [`${i + 1}. ${s.name}`, n2(s.close), n2(s.prev), signed(s.pct)]) },
    { title: 'Fresh real estate news (realtynmore.com)', head: ['Story', 'Website views'], rows: (d.news ?? []).map((s) => [s.title, s.views ?? '–']) },
  ]
  return (
    <>
      <div className="reel-pick">
        <select className="wide-select" value={d.day} onChange={(e) => setDay(e.target.value)} aria-label="Trading day">
          {d.days.map((x) => (
            <option key={x} value={x}>
              {fmtDay(x)}
            </option>
          ))}
        </select>
      </div>
      <div className="kpis">
        <div className={`kpi ${(idx?.pct ?? 0) < 0 ? 'warn' : ''}`}>
          <b>{n2(idx?.close)}</b>
          <span>Nifty Realty {signed(idx?.pct ?? 0)}</span>
        </div>
        <div className="kpi">
          <b>
            {cons.filter((s) => s.pct > 0).length} / {cons.filter((s) => s.pct < 0).length}
          </b>
          <span>Gainers / decliners</span>
        </div>
        <div className="kpi">
          <b>{d.news?.length ?? 0}</b>
          <span>Our stories that day</span>
        </div>
      </div>
      {script ? (
        <Panel title="Daily voiceover: decliners first, then gainers" note={script.dateLine}>
          <SceneEditor script={script} onChange={setScenes} />
          <ScriptActions script={script} fileName={`RealtyNMore_${d.day}_MARKET_CLOSE.doc`} tables={tables} />
        </Panel>
      ) : (
        <p className="panel-note">No Nifty Realty close saved for this day.</p>
      )}
      <Panel title="Constituents" note="NSE official closes; change against NSE's previous close.">
        <MoveList rows={cons.map((s) => ({ name: s.name, close: s.close, pct: s.pct }))} />
      </Panel>
      <RelatedNews stories={d.news ?? []} symbols={cons.map((s) => s.symbol)} />
    </>
  )
}

function WeeklyView() {
  const [day, setDay] = useState<string | null>(null)
  const res = useAsync(`studio:reel-weekly:${day ?? 'latest'}`, (s) => studio<WeeklyRes>(`reels/weekly${day ? `?day=${day}` : ''}`, undefined, s))
  const w = res.data
  const base = useMemo(() => {
    if (!w?.ready) return null
    try {
      return weeklyScript(w as Weekly)
    } catch {
      return null
    }
  }, [w])
  const { script, setScenes } = useEdited(base)
  if (res.error && !w) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!w) return <SkeletonList count={3} />
  if (!w.week) return <NoData />
  const t = w.ready ? weeklyTables(w as Weekly) : null
  const tables = t
    ? [
        { title: 'Weekly index comparison', head: ['Index', `${w.base} close`, `${w.last} close`, 'Pts change', '% change'], rows: t.indexRows.map((r) => [r.name, n2(r.from), n2(r.to), n2(r.pts), signed(r.pct)]) },
        { title: 'Nifty Realty: daily performance', head: ['Session', 'Open', 'High', 'Low', 'Close', 'Pts', '%'], rows: t.sessions.map((s) => [fmtDay(s.day), n2(s.open), n2(s.high), n2(s.low), n2(s.close), n2(s.pts), signed(s.pct ?? 0)]) },
        { title: 'Nifty Realty constituents, weekly', head: ['#', 'Company', 'Symbol', 'From (₹)', 'To (₹)', '% change'], rows: t.constituents.map((s, i) => [i + 1, s.name, s.symbol, n2(s.from), n2(s.to), signed(s.pct)]) },
        { title: 'Broader real-estate watchlist (not index constituents)', head: ['Company', 'Symbol', 'From (₹)', 'To (₹)', '% change'], rows: t.watchlist.map((s) => [s.name, s.symbol, n2(s.from), n2(s.to), signed(s.pct)]) },
        { title: 'This week on realtynmore.com', head: ['Story', 'Website views'], rows: (w.news ?? []).map((s) => [s.title, s.views ?? '–']) },
      ]
    : []
  const realty = t?.indexRows.find((r) => r.name === 'Nifty Realty')
  return (
    <>
      <div className="reel-pick">
        <select className="wide-select" value={w.week} onChange={(e) => setDay(e.target.value)} aria-label="Week">
          {w.weeks.map((x) => (
            <option key={x} value={x}>
              Week of {fmtDay(x)}
            </option>
          ))}
        </select>
      </div>
      {!w.ready || !t ? (
        <p className="panel-note">This week needs the previous week’s last close as its base. Ask the owner to fetch it (below), or pick another week.</p>
      ) : (
        <>
          <div className="kpis">
            <div className={`kpi ${(realty?.pct ?? 0) < 0 ? 'warn' : ''}`}>
              <b>{signed(realty?.pct ?? 0)}</b>
              <span>Nifty Realty, week to {fmtDay(w.last!)}</span>
            </div>
            <div className="kpi">
              <b>
                {t.constituents.filter((s) => s.pct > 0).length} / {t.constituents.filter((s) => s.pct < 0).length}
              </b>
              <span>Index stocks up / down</span>
            </div>
            <div className="kpi">
              <b>{t.sessions.length}</b>
              <span>Sessions{t.holiday ? ' (holiday week)' : ''}</span>
            </div>
          </div>
          {script && (
            <Panel title="Weekly voiceover" note={script.dateLine}>
              <SceneEditor script={script} onChange={setScenes} />
              <ScriptActions script={script} fileName={`RealtyNMore_Weekly_Market_Close_${w.sessions![0]}_${w.last}.doc`} tables={tables} />
            </Panel>
          )}
          <div className="web-two">
            <Panel title="Index stocks this week">
              <MoveList rows={t.constituents.map((s) => ({ name: s.name, close: s.to, pct: s.pct }))} />
            </Panel>
            <Panel title="Other developers this week">
              <MoveList rows={t.watchlist.map((s) => ({ name: s.name, close: s.to, pct: s.pct }))} />
            </Panel>
          </div>
          <RelatedNews stories={w.news ?? []} symbols={t.constituents.map((s) => s.symbol)} />
        </>
      )}
    </>
  )
}

function MoveList({ rows }: { rows: { name: string; close: number; pct: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pct)))
  return (
    <div className="reel-moves">
      {rows.map((r) => (
        <div key={r.name} className="reel-move">
          <span className="reel-move-name">{r.name}</span>
          <span className="reel-move-bar">
            <span className={r.pct < 0 ? 'down' : 'up'} style={{ width: `${(Math.abs(r.pct) / max) * 100}%` }} />
          </span>
          <span className={`reel-move-pct ${r.pct < 0 ? 'down' : r.pct > 0 ? 'up' : ''}`}>{signed(r.pct)}</span>
        </div>
      ))}
    </div>
  )
}

/** Our stories for the period, and other publications' headlines that name the index stocks (public, cached). */
function RelatedNews({ stories, symbols }: { stories: Daily['news']; symbols: string[] }) {
  const movers = useAsync(PUSH_API ? 'market:news' : null, async (signal) => {
    const r = await fetch(`${PUSH_API}/market/news`, { signal })
    if (!r.ok) throw new Error('Market news is not available right now.')
    return (await r.json()) as MoverNews
  })
  const named = (movers.data?.stocks ?? []).filter((s) => symbols.includes(s.symbol) && s.news.length)
  return (
    <Panel title="Related news" note="Use only facts a story states. A headline appearing on the same day is not a reason for a move.">
      <h3 className="reel-h3">On realtynmore.com</h3>
      {stories.length ? (
        <ul className="reel-news">
          {stories.map((s) => (
            <li key={s.id}>
              <a href={s.link} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
              <small>
                {formatDateTime(s.date)}
                {s.views != null ? ` · ${s.views.toLocaleString('en-IN')} website views` : ''}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel-note">No stories in this period.</p>
      )}
      <h3 className="reel-h3">Other publications naming these stocks (last 3 days)</h3>
      {named.length ? (
        <ul className="reel-news">
          {named.flatMap((s) =>
            s.news.slice(0, 2).map((n) => (
              <li key={n.link}>
                <a href={n.link} target="_blank" rel="noopener noreferrer">
                  {n.title}
                </a>
                <small>
                  {s.name} · {n.source} · {formatDateTime(n.date)}
                </small>
              </li>
            )),
          )}
        </ul>
      ) : (
        <p className="panel-note">{movers.data ? 'None found.' : 'Loading…'}</p>
      )}
    </Panel>
  )
}

function NoData() {
  return <p className="panel-note">No market closes saved yet. They are saved automatically every weekday evening after NSE publishes them; the owner can also fetch past days below.</p>
}

/** Reference files for the week (CSV, Word, PDF, images); kept privately for the team. */
function References() {
  const res = useAsync('studio:reel-refs', (s) => studio<{ refs: Ref[] }>('reels/refs', undefined, s))
  const [kind, setKind] = useState('daily')
  const [busy, setBusy] = useState(false)
  const isOwner = hasFullAccess()
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    try {
      for (const f of files) {
        const q = new URLSearchParams({ name: f.name, kind, week: new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10) })
        const r = await fetch(`${PUSH_API}/editor/reels/ref-upload?${q}`, { method: 'POST', headers: { Authorization: `Bearer ${ownerKey()}`, 'Content-Type': f.type || 'application/octet-stream' }, body: f })
        const j = (await r.json()) as { error?: string }
        if (!r.ok) throw new Error(j.error ?? `Upload failed (${r.status})`)
      }
      toast(files.length === 1 ? 'Reference saved' : `${files.length} references saved`)
      res.reload()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const open = async (r: Ref) => {
    try {
      const resp = await fetch(`${PUSH_API}/editor/reels/ref?id=${r.id}`, { headers: { Authorization: `Bearer ${ownerKey()}` } })
      if (!resp.ok) throw new Error('Could not download')
      const blob = await resp.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = r.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (err) {
      toast((err as Error).message)
    }
  }
  const remove = async (r: Ref) => {
    if (!window.confirm(`Delete ${r.name}?`)) return
    await studioPost('reels/ref-remove', { id: r.id }).catch((err: Error) => toast(err.message))
    res.reload()
  }
  const byWeek = new Map<string, Ref[]>()
  for (const r of res.data?.refs ?? []) byWeek.set(r.week, [...(byWeek.get(r.week) ?? []), r])
  return (
    <Panel title="References" note="Upload the week’s reference files (NSE CSV, Word, PDF, screenshots). Everyone with a team key sees them here; nothing is public.">
      <div className="reel-upload">
        <div className="segmented small" role="radiogroup" aria-label="Reference for">
          {(['daily', 'weekly', 'other'] as const).map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {k === 'daily' ? 'Daily' : k === 'weekly' ? 'Weekly' : 'Other'}
            </button>
          ))}
        </div>
        <label className={`btn small ${busy ? 'disabled' : ''}`}>
          <Icon name="download" size={15} /> {busy ? 'Uploading…' : 'Upload files'}
          <input type="file" multiple hidden disabled={busy} accept=".csv,.xls,.xlsx,.doc,.docx,.pdf,.txt,.png,.jpg,.jpeg,.webp" onChange={upload} />
        </label>
      </div>
      {res.error && !res.data ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : byWeek.size === 0 ? (
        <p className="panel-note">No references yet.</p>
      ) : (
        [...byWeek].map(([week, refs]) => (
          <div key={week} className="reel-ref-week">
            <h3 className="reel-h3">Week of {fmtDay(week)}</h3>
            <ul className="reel-refs">
              {refs.map((r) => (
                <li key={r.id}>
                  <button className="reel-ref" onClick={() => open(r)}>
                    <Icon name="download" size={15} />
                    <span>
                      {r.name}
                      <small>
                        {r.kind} · {Math.max(1, Math.round(r.size / 1024))} KB · {r.byName} · {formatDateTime(r.at)}
                      </small>
                    </span>
                  </button>
                  {isOwner && (
                    <button className="icon-btn" onClick={() => remove(r)} aria-label={`Delete ${r.name}`}>
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Panel>
  )
}

/** Owner: fetch a past trading day from NSE (for weekly bases and streaks). */
function FetchDay() {
  const [day, setDay] = useState('')
  const [busy, setBusy] = useState(false)
  if (!hasFullAccess()) return null
  const run = async () => {
    setBusy(true)
    try {
      const r = await studioPost<{ result: string }>('reels/capture', { day })
      toast(r.result)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="reel-fetch">
      <span className="panel-note">Missing a day? Fetch NSE’s official closes:</span>
      <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day to fetch" />
      <button className="mini-btn" disabled={!day || busy} onClick={run}>
        {busy ? 'Fetching…' : 'Fetch'}
      </button>
    </div>
  )
}

export function ReelsTab() {
  const [kind, setKind] = useState<'daily' | 'weekly'>('daily')
  return (
    <>
      <div className="segmented wide" role="radiogroup" aria-label="Script">
        <button role="radio" aria-checked={kind === 'daily'} className={kind === 'daily' ? 'on' : ''} onClick={() => setKind('daily')}>
          Daily market close
        </button>
        <button role="radio" aria-checked={kind === 'weekly'} className={kind === 'weekly' ? 'on' : ''} onClick={() => setKind('weekly')}>
          Weekly market close
        </button>
      </div>
      {kind === 'daily' ? <DailyView /> : <WeeklyView />}
      <References />
      <FetchDay />
    </>
  )
}
