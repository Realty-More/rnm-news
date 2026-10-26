// Daily and weekly market-close reel scripts, in the house format of the RealtyNMore reports:
// decliners first, then gainers; numbers only from NSE's official closes; news only from our
// own stories, quoted as written; no stock move is given a cause.
import { sentences } from './keypoints.ts'

export interface IndexRow { name: string; open: number | null; high: number | null; low: number | null; close: number; pts: number | null; pct: number | null }
export interface StockRow { symbol: string; name: string; index: boolean; prev: number; close: number }
export interface Story { id: number; title: string; link: string; date: string; excerpt: string; views: number | null }
export interface Daily { day: string; indices: IndexRow[]; history: { day: string; close: number; pct: number }[]; stocks: StockRow[]; news: Story[]; source: string }
export interface Weekly {
  week: string
  sessions: string[]
  base: string
  last: string
  indices: (IndexRow & { day: string })[]
  moves: { symbol: string; name: string; index: boolean; from: number; to: number }[]
  news: Story[]
  source: string
}
export interface Scene { scene: string; vo: string; screen: string }
export interface Script { kind: 'daily' | 'weekly'; title: string; dateLine: string; scenes: Scene[]; checks: string[]; sources: string[] }

const MINUS = '−'
export const pctChange = (from: number, to: number) => Math.round(((to - from) / from) * 10000) / 100
const n2 = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const abs = (p: number) => `${Math.abs(p).toFixed(2)}%`
/** On-screen signed percent with a real minus sign: "−2.38%". */
export const signed = (p: number) => `${p > 0 ? '+' : p < 0 ? MINUS : ''}${Math.abs(p).toFixed(2)}%`
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const say = (k: number) => NUM[k] ?? String(k)
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const weekday = (day: string) => DAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]
const longDate = (day: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${day}T00:00:00Z`))
const dayMonth = (day: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(`${day}T00:00:00Z`))

/** Short upper-case label for on-screen text ("Godrej Properties" → "GODREJ PROPERTIES", max two words). */
export const screenName = (name: string) =>
  name
    .replace(/\b(Limited|Ltd\.?|Enterprises|Developers|Estates Projects|Projects)\b/gi, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ')
    .toUpperCase()

const DATELINE = /^[A-Z][A-Za-z .()-]{2,40},\s*(?:[A-Z][a-z]+\.?\s+\d{1,2}|\d{1,2}\s+[A-Z][a-z]+)(?:,?\s*\d{4})?\s*[:\-–—]\s*/
/** The story's first sentence, without the dateline: the reporter's own words. */
export function lede(excerpt: string): string {
  const first = sentences(excerpt.replace(/\s*\[?(…|\.\.\.)\]?\s*$/, '').trim())[0] ?? ''
  return first.replace(DATELINE, '').trim()
}

function moveVerb(p: number): string {
  if (p <= -2) return 'fell sharply'
  if (p < -0.3) return 'fell'
  if (p < 0) return 'edged lower'
  if (p === 0) return 'ended flat'
  if (p < 0.3) return 'edged higher'
  if (p < 2) return 'rose'
  return 'rose sharply'
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length
/** Seconds at a measured newsroom pace (214 words ≈ 84 s in the weekly reference). */
export const secondsFor = (text: string) => Math.round(words(text) / 2.55)
export function timeline(scenes: Scene[]): { from: number; to: number }[] {
  let t = 0
  return scenes.map((s) => {
    const from = t
    t += Math.max(3, secondsFor(s.vo))
    return { from, to: t }
  })
}
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function newsScenes(stories: Story[], max: number, label: string): Scene[] {
  const picked = [...stories].sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || b.date.localeCompare(a.date)).slice(0, max)
  return picked
    .map((s) => ({ s, line: lede(s.excerpt) }))
    .filter(({ line }) => line.length > 30)
    .map(({ s, line }) => ({ scene: `${label} · ${s.title.split(/\s+/).slice(0, 4).join(' ')}`, vo: line, screen: s.title.split(/\s+/).slice(0, 6).join(' ').toUpperCase() }))
}

const CTA_DAILY = 'Save this update, share it with someone tracking Indian real estate, and follow RealtyNMore for your daily market close.'

export function dailyScript(d: Daily): Script {
  const idx = d.indices.find((i) => i.name === 'Nifty Realty')
  if (!idx) throw new Error('No Nifty Realty close for this day.')
  const p = idx.pct ?? 0
  const stocks = d.stocks.filter((s) => s.index).map((s) => ({ ...s, pct: pctChange(s.prev, s.close) }))
  const total = stocks.length
  const down = stocks.filter((s) => s.pct < 0).sort((a, b) => a.pct - b.pct)
  const up = stocks.filter((s) => s.pct > 0).sort((a, b) => b.pct - a.pct)
  const scenes: Scene[] = []

  scenes.push({
    scene: 'Opening',
    vo: `Realty stocks ${moveVerb(p)} on ${weekday(d.day)}. The Nifty Realty index ended at ${n2(idx.close)}, ${p === 0 ? 'unchanged' : `${p < 0 ? 'down' : 'up'} ${abs(p)}`} from the previous close.`,
    screen: `NIFTY REALTY ${n2(idx.close)}  |  ${signed(p)}`,
  })

  const top = down.slice(0, 4)
  if (top.length) {
    const verbs = ['fell', 'lost', 'slipped']
    const rest = top.slice(1).map((s, i) => `${s.name} ${verbs[i]} ${abs(s.pct)}`)
    const list = rest.length > 1 ? `${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}` : rest[0]
    const breadth = down.length === total ? ` Overall, all ${say(total)} realty stocks ended lower.` : ` In all, ${say(down.length)} of the ${say(total)} index stocks ended lower.`
    scenes.push({
      scene: 'Decliners',
      vo: `${top[0].name} was the biggest decliner, down ${abs(top[0].pct)}.${list ? ` ${list}.` : ''}${breadth}`,
      screen: top.map((s) => `${screenName(s.name)} ${signed(s.pct)}`).join('  |  '),
    })
  }

  if (up.length) {
    const others = up.slice(1, 3).map((s) => `${s.name} at ${abs(s.pct)}`)
    scenes.push({
      scene: 'Gainers',
      vo:
        up.length === total
          ? `All ${say(total)} realty stocks ended higher. ${up[0].name} led, up ${abs(up[0].pct)}${others.length ? `, followed by ${others.join(' and ')}` : ''}.`
          : `On the gainers' side, ${up[0].name} rose most, up ${abs(up[0].pct)}${others.length ? `, followed by ${others.join(' and ')}` : ''}.`,
      screen: up.slice(0, 3).map((s) => `${screenName(s.name)} ${signed(s.pct)}`).join('  |  '),
    })
  } else if (down.length > top.length) {
    const best = [...down].reverse().slice(0, 3).filter((s) => !top.includes(s))
    if (best.length) {
      const tail = best.slice(1).map((s) => `${s.name} at ${abs(s.pct)}`)
      scenes.push({
        scene: 'Smallest declines',
        vo: `There were no gainers today. ${best[0].name} held up best, down ${abs(best[0].pct)}${tail.length ? `, followed by ${tail.join(' and ')}` : ''}.`,
        screen: ['NO GAINERS', ...best.map((s) => `${screenName(s.name)} ${signed(s.pct)}`)].join('  |  '),
      })
    }
  }

  scenes.push(...newsScenes(d.news, 3, 'News'))

  // Same-direction run of sessions, from the saved index history (newest first).
  let streak = 0
  for (const h of d.history) {
    if (Math.sign(h.pct) !== Math.sign(p) || p === 0) break
    streak++
  }
  const bigDrops = down.filter((s) => s.pct <= -4).length
  const breadth = down.length === total ? 'every stock in the index lower' : up.length === total ? 'every stock in the index higher' : `${say(down.length)} of ${say(total)} stocks lower and ${say(up.length)} higher`
  scenes.push({
    scene: 'Takeaway',
    vo:
      streak >= 2 && ORD[streak]
        ? `The takeaway: realty stocks ${p < 0 ? 'fell' : 'rose'} for a ${ORD[streak]} straight session, with ${breadth}${bigDrops >= 2 ? `, and ${say(bigDrops)} of them down more than 4%` : ''}.`
        : `The takeaway: the Nifty Realty index ${p < 0 ? 'ended lower' : p > 0 ? 'ended higher' : 'ended flat'}, with ${breadth}.`,
    screen: streak >= 2 ? `${ORD[streak].toUpperCase()} STRAIGHT ${p < 0 ? 'FALL' : 'RISE'}  |  ${down.length} DOWN · ${up.length} UP` : `${down.length} DOWN · ${up.length} UP`,
  })
  scenes.push({ scene: 'CTA', vo: CTA_DAILY, screen: 'SAVE  |  SHARE  |  FOLLOW' })

  return {
    kind: 'daily',
    title: 'Realty Market Update',
    dateLine: longDate(d.day),
    scenes,
    checks: [
      `Prices are NSE official closing prices for ${longDate(d.day)}; changes are measured against NSE's previous close for each stock.`,
      `Breadth: ${up.length} gainers, ${down.length} decliners among ${total} Nifty Realty stocks.`,
      streak >= 2 ? `Streak: Nifty Realty ${p < 0 ? 'fell' : 'rose'} in each of the last ${streak} saved sessions (${d.history.slice(0, streak).map((h) => dayMonth(h.day)).reverse().join(', ')}).` : 'Streak: no run of two or more sessions in the same direction.',
      'News lines are the first sentence of each RealtyNMore story, word for word. Check figures in the full story before recording.',
      'No stock move is attributed to a cause.',
    ],
    sources: [d.source, ...d.news.slice(0, 3).map((s) => `RealtyNMore: ${s.title} (${s.link})`)],
  }
}

export interface WeeklyTables {
  indexRows: { name: string; from: number; to: number; pts: number; pct: number }[]
  sessions: { day: string; open: number | null; high: number | null; low: number | null; close: number; pts: number | null; pct: number | null }[]
  constituents: { name: string; symbol: string; from: number; to: number; pct: number }[]
  watchlist: { name: string; symbol: string; from: number; to: number; pct: number }[]
  holiday: boolean
}

export function weeklyTables(w: Weekly): WeeklyTables {
  const at = (day: string, name: string) => w.indices.find((i) => i.day === day && i.name === name)
  const order = ['Nifty 50', 'Nifty Realty', 'Nifty Bank', 'Nifty Midcap 100', 'Nifty Smallcap 100']
  const indexRows = order.flatMap((name) => {
    const a = at(w.base, name)
    const b = at(w.last, name)
    return a && b ? [{ name, from: a.close, to: b.close, pts: Math.round((b.close - a.close) * 100) / 100, pct: pctChange(a.close, b.close) }] : []
  })
  const sessions = w.sessions.flatMap((day) => {
    const r = at(day, 'Nifty Realty')
    return r ? [{ day, open: r.open, high: r.high, low: r.low, close: r.close, pts: r.pts, pct: r.pct }] : []
  })
  const rank = (list: Weekly['moves']) => list.map((m) => ({ name: m.name, symbol: m.symbol, from: m.from, to: m.to, pct: pctChange(m.from, m.to) })).sort((a, b) => b.pct - a.pct)
  // A weekday missing between Monday and the last session means a market holiday.
  const mon = Date.parse(`${w.week}T00:00:00Z`)
  const lastT = Date.parse(`${w.last}T00:00:00Z`)
  const expected = Math.round((lastT - mon) / 86400000) + 1
  return { indexRows, sessions, constituents: rank(w.moves.filter((m) => m.index)), watchlist: rank(w.moves.filter((m) => !m.index)), holiday: w.sessions.length < expected }
}

export function weeklyScript(w: Weekly): Script {
  const t = weeklyTables(w)
  const idx = (name: string) => t.indexRows.find((r) => r.name === name)
  const realty = idx('Nifty Realty')
  const nifty = idx('Nifty 50')
  if (!realty) throw new Error('No Nifty Realty closes for this week.')
  const span = `${new Date(`${w.sessions[0]}T00:00:00Z`).getUTCDate()} to ${dayMonth(w.last)}`
  const dir = (p: number, fall = 'fell', rise = 'rose') => (p < 0 ? fall : p > 0 ? rise : 'was flat')
  const scenes: Scene[] = []
  scenes.push({
    scene: 'Hook',
    vo: `Realty and More's weekly market close, for the week of ${span}. Real estate stocks ended the week ${realty.pct < 0 ? 'lower' : realty.pct > 0 ? 'higher' : 'flat'}.`,
    screen: `WEEK OF ${span.toUpperCase().replace(' TO ', '–')}`,
  })
  if (nifty) {
    const small = idx('Nifty Smallcap 100')
    const mid = idx('Nifty Midcap 100')
    const caps = [small && `small caps ${dir(small.pct)} ${abs(small.pct).replace('%', ' per cent')}`, mid && `mid caps ${dir(mid.pct)} ${abs(mid.pct).replace('%', ' per cent')}`].filter(Boolean)
    scenes.push({
      scene: 'Benchmarks',
      vo: `${t.holiday ? 'In a holiday-shortened week, the' : 'This week, the'} Nifty 50 ${dir(nifty.pct, 'lost', 'gained')} ${abs(nifty.pct).replace('%', ' per cent')} to ${n2(nifty.to)}.${caps.length ? ` ${caps.join(', and ').replace(/^./, (c) => c.toUpperCase())}.` : ''}`,
      screen: `NIFTY 50 ${signed(nifty.pct)}${small ? ` · SMALLCAP ${signed(small.pct)}` : ''}`,
    })
  }
  const downDays = t.sessions.filter((s) => (s.pct ?? 0) < 0)
  const upDays = t.sessions.filter((s) => (s.pct ?? 0) > 0)
  const n = t.sessions.length
  const runs = downDays.length === n ? `falling in all ${say(n)} sessions` : upDays.length === n ? `rising in all ${say(n)} sessions` : `rising in ${say(upDays.length)} of ${say(n)} sessions`
  const worst = [...t.sessions].sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))[0]
  const best = [...t.sessions].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0]
  const keyDay = realty.pct < 0 ? worst : best
  scenes.push({
    scene: 'Nifty Realty',
    vo: `The Nifty Realty index ${dir(realty.pct, 'dropped', 'gained')} ${abs(realty.pct).replace('%', ' per cent')} to ${n2(realty.to)}, ${runs}.${keyDay && keyDay.pct ? ` ${weekday(keyDay.day)} was the ${realty.pct < 0 ? 'worst' : 'best'} day, ${keyDay.pct < 0 ? 'down' : 'up'} ${abs(keyDay.pct).replace('%', ' per cent')}.` : ''}`,
    screen: `NIFTY REALTY ${signed(realty.pct)}`,
  })
  const c = t.constituents
  if (c.length) {
    const fell = c.filter((s) => s.pct < 0).length
    const lead = fell === c.length ? `All ${say(c.length)} index stocks fell.` : fell === 0 ? `All ${say(c.length)} index stocks rose.` : `${say(c.length - fell).replace(/^./, (x) => x.toUpperCase())} of the ${say(c.length)} index stocks rose and ${say(fell)} fell.`
    const worstTwo = [...c].reverse().slice(0, 2)
    const top1 = c[0]
    scenes.push({
      scene: 'Constituents',
      vo: `${lead} ${worstTwo[0].name} was the biggest laggard, ${worstTwo[0].pct < 0 ? 'down' : 'up just'} ${abs(worstTwo[0].pct).replace('%', ' per cent')}${worstTwo[1] ? `, followed by ${worstTwo[1].name} at ${abs(worstTwo[1].pct).replace('%', ' per cent')}` : ''}. ${top1.name} ${top1.pct >= 0 ? `led, up ${abs(top1.pct).replace('%', ' per cent')}` : `held up best, down just ${abs(top1.pct).replace('%', ' per cent')}`}.`,
      screen: `${c.length - fell} UP · ${fell} DOWN`,
    })
  }
  const wl = t.watchlist
  if (wl.length >= 2) {
    const hi = wl[0]
    const lo = wl[wl.length - 1]
    scenes.push({
      scene: 'Broader stocks',
      vo: `Among other developers, ${hi.name} ${hi.pct > 0 && realty.pct < 0 ? `bucked the trend with a ${abs(hi.pct).replace('%', ' per cent')} gain` : `${hi.pct >= 0 ? 'rose' : 'fell'} ${abs(hi.pct).replace('%', ' per cent')}`}, while ${lo.name} ${lo.pct < 0 ? 'fell' : 'rose'} ${abs(lo.pct).replace('%', ' per cent')}.`,
      screen: `${screenName(hi.name)} ${signed(hi.pct)}`,
    })
  }
  scenes.push(...newsScenes(w.news, 2, 'In the news'))
  scenes.push({ scene: 'Close', vo: 'Save, share and follow RealtyNMore for your weekly market close.', screen: 'FOLLOW REALTYNMORE' })

  return {
    kind: 'weekly',
    title: 'Weekly Real Estate Market Close',
    dateLine: `${span} ${w.last.slice(0, 4)} · ${n} session${n === 1 ? '' : 's'}${t.holiday ? ' (market holiday in the week)' : ''} · Base: ${longDate(w.base)} close · NSE closes`,
    scenes,
    checks: [
      `Reporting period: ${w.sessions.map(dayMonth).join(', ')}; base ${longDate(w.base)} close.`,
      'All index levels and stock prices are NSE official closes; no intraday prices are used as closes.',
      'All changes are recomputed from the closes and rounded to two decimals.',
      'Watchlist stocks are never described as Nifty Realty constituents.',
      'Reasons for moves are not included automatically. Add only reasons that a publication stated, and credit it.',
      'Sensex is not included (BSE data is not in NSE files). Add it from a reliable source if needed.',
    ],
    sources: [w.source, ...w.news.slice(0, 5).map((s) => `RealtyNMore: ${s.title} (${s.link})`)],
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

/** Word-compatible document (opens in Word / Google Docs) in the house style. */
export function scriptDoc(s: Script, tables: { title: string; head: string[]; rows: (string | number)[][] }[]): string {
  const tl = timeline(s.scenes)
  const total = tl[tl.length - 1]?.to ?? 0
  const wc = s.scenes.reduce((a, x) => a + words(x.vo), 0)
  const table = (head: string[], rows: (string | number)[][]) =>
    `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(String(c))}</td>`).join('')}</tr>`).join('')}</table>`
  let k = 0
  const h = (t: string) => `<h2>${String(++k).padStart(2, '0')}  |  ${esc(t)}</h2>`
  return `<html><head><meta charset="utf-8"><title>${esc(s.title)}</title><style>
    body { font-family: Aptos, Calibri, Arial, sans-serif; color: #353537; font-size: 11pt; }
    .kicker { color: #F5A400; font-weight: 700; letter-spacing: 2px; font-size: 9pt; }
    h1 { font-size: 24pt; margin: 4px 0; } h2 { font-size: 13pt; border-bottom: 2px solid #F5A400; padding-bottom: 3px; margin-top: 22px; }
    table { border-collapse: collapse; width: 100%; margin: 6px 0; } th { background: #353537; color: #fff; text-align: left; padding: 5px; font-size: 9.5pt; }
    td { border-bottom: 1px solid #ddd; padding: 5px; font-size: 10pt; vertical-align: top; } .note { color: #6D6D70; font-size: 9pt; }
  </style></head><body>
  <div class="kicker">${s.kind === 'daily' ? 'MARKET CLOSE' : 'WEEKLY REAL ESTATE MARKET INTELLIGENCE'}</div>
  <h1>${esc(s.title)}</h1><p>${esc(s.dateLine)}</p>
  ${s.kind === 'daily' ? '<p class="kicker">VOICEOVER ORDER: DECLINERS FIRST, THEN GAINERS</p>' : ''}
  ${tables.map((t) => h(t.title) + table(t.head, t.rows)).join('')}
  ${h(`Final voiceover script (${wc} words · about ${total} seconds)`)}
  ${table(['Scene', 'Voiceover', 'On-screen text', 'Time'], s.scenes.map((x, i) => [`${i + 1} · ${x.scene}`, x.vo, x.screen, `${clock(tl[i].from)}–${clock(tl[i].to)}`]))}
  ${h('Brand & editing direction')}
  <p>Canvas: vertical 9:16 (1080 × 1920) for Reels / Shorts. Palette: charcoal #353537, orange #F5A400, grey #6D6D70, light grey #F4F4F4; restrained red and green only for market moves. Voiceover is the master timeline; on-screen text at least 64 px and no more than six words per card. Use rights-cleared visuals only; never fabricate exchange screens.</p>
  ${h('Accuracy checklist')}<ul>${s.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  ${h('Sources')}<ol>${s.sources.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>
  <p class="note">Generated by the RealtyNMore app from NSE official files and realtynmore.com. Recheck before publishing.</p>
  </body></html>`
}
