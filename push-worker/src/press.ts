// Press release → Realty & More story, in the desk's house style (learned from how Arun sir edits
// press releases for realtynmore.com):
//   • a new, shorter Title Case headline that says what happened (reports end with ": Source")
//   • bold dateline "City, Month D, YYYY:" (made here, not by the AI)
//   • a rewritten lead ending ", according to a company press release."
//   • two or three short paragraphs in our own words, every number kept exactly
//   • the spokesperson quote word for word: "Commenting on …, **Name**, Designation, **Company**, said, “…”"
//   • a closing paragraph; no "About the company", media contacts, tables or bullet lists
//   • claims like "India's largest" softened to "a leading"
// Quotes are copied from the release by this code (the AI only says whose quote it is), and every
// number in the story is checked against the release.
// The story type follows the site's categories: News, Leadership Updates (appointments), Report,
// New Launches, RERA, Events, and Guest Column. A guest column (an expert's own article) is not
// rewritten: it keeps the author's text, gets a bold-italic "By Name, Designation, Company" line,
// bold subheadings and the site's disclaimer, with no dateline.
// Photos sent with the release are kept with the draft (KV pr:img:<draft>:<n>, details in pr_images)
// so whoever publishes it later has them, with the place each one goes.
import type { Env } from './index.ts'
import type { Who } from './owner.ts'

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const BACKUP = '@cf/qwen/qwen3-30b-a3b-fp8'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MON = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
const monthName = (m: string) => MONTHS.find((x) => x.toLowerCase().startsWith(m.slice(0, 3).toLowerCase()))!

const istToday = (ms = Date.now()) => new Date(ms + 5.5 * 3600000)

/** Story types, named as the categories on realtynmore.com. */
export const CATEGORIES = {
  news: 'News',
  leadership: 'Leadership Updates',
  report: 'Report',
  launch: 'New Launches',
  rera: 'RERA',
  event: 'Events',
  guest: 'Guest Column',
} as const
export type Kind = keyof typeof CATEGORIES
export const isKind = (v: unknown): v is Kind => typeof v === 'string' && v in CATEGORIES

const CITY = '([A-Z][A-Za-z.]+(?:[ -][A-Z][A-Za-z.]+){0,2})'
/** The release's own dateline, if it has one. */
function findDateline(raw: string, today: string): { city: string; date: string } | null {
  const head = raw.slice(0, 2500)
  // New Delhi, 27th October, 2026:   |   Mumbai, October 27, 2026:   |   New Delhi, October 2026:
  const a = new RegExp(`${CITY}\\s*,\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON},?\\s*(\\d{4})`).exec(head)
  if (a) return { city: a[1].trim(), date: `${monthName(a[3])} ${Number(a[2])}, ${a[4]}` }
  const b = new RegExp(`${CITY}\\s*,\\s*${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})`).exec(head)
  if (b) return { city: b[1].trim(), date: `${monthName(b[2])} ${Number(b[3])}, ${b[4]}` }
  const c = new RegExp(`${CITY}\\s*,\\s*${MON},?\\s*(\\d{4})\\s*[:–-]`).exec(head)
  if (c) return { city: c[1].trim(), date: today }
  return null
}

/** "City, Month D, YYYY" from the release's dateline; a missing day or date uses today (IST). */
export function datelineFrom(raw: string, now = Date.now()): { city: string; date: string } {
  const t = istToday(now)
  const today = `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`
  return findDateline(raw, today) ?? { city: 'New Delhi', date: today }
}

/** An expert's own article rather than a company announcement. */
export function looksLikeGuest(raw: string): boolean {
  const head = raw.slice(0, 1500)
  if (/views expressed (in this|are)|authored by|guest column|opinion piece|about the author/i.test(raw)) return true
  if (/^\s*(by|written by)\s+[A-Z][a-z]+/m.test(head)) return true
  const pressy = /press release|for immediate release|media contact|\b(announced|announces|has (signed|appointed|launched|secured|reported|unveiled))\b/i.test(head)
  return !pressy && !findDateline(raw, '') && raw.length > 2500 && quotesIn(raw).length === 0
}

/** The release without contact blocks, boilerplate and tables, joined into clean paragraphs. */
export function cleanRelease(raw: string): string {
  const lines = raw.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim())
  const out: string[] = []
  for (const l of lines) {
    if (/^(about\b|media contact|for media|for (further|more) (information|details)|press contact|contact:|disclaimer|safe harbou?r|\*?order classification|notes? to (the )?editors?)/i.test(l)) break
    if (!l || /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(l) || /^(\+?\d[\d\s-]{8,})$/.test(l)) continue
    out.push(l)
  }
  return out.join('\n').slice(0, 9000)
}

/** Quotes in the release (straight or curly marks), longest first. */
export function quotesIn(raw: string): string[] {
  const found = new Set<string>()
  // PDFs break lines inside a quote; join them back.
  for (const m of raw.matchAll(/[“"]([^“”"]{40,})[”"]/g)) found.add(m[1].replace(/\s+/g, ' ').trim())
  return [...found].sort((a, b) => b.length - a.length).slice(0, 4)
}

const digits = (s: string) => s.replace(/,/g, '')
/** Numbers in the story that do not appear in the release (a sign the AI changed or invented one). */
export function unknownNumbers(story: string, raw: string): string[] {
  const src = digits(raw)
  const nums = (story.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(digits)
  return [...new Set(nums.filter((n) => n.length > 0 && !src.includes(n)))]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** *Report Title* → <em>, **Name** → <strong>; everything else as text. */
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
const plain = (s: string) => s.replace(/\*\*\*([^*]+)\*\*\*/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
const tidy = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')

interface AiOut {
  headlines?: string[]
  lead?: string
  before?: string[]
  quotes?: { n?: number; intro?: string; name?: string; designation?: string; company?: string }[]
  after?: string[]
  tags?: string[]
  meta?: string
  category?: string
  appointees?: { name?: string; designation?: string }[]
}

/** Someone in the story, for placing their photo: the author, a new appointee or a spokesperson. */
export interface Person {
  name: string
  designation: string
  company: string
  role: 'author' | 'appointee' | 'speaker'
}

export interface PressStory {
  headlines: string[]
  dateline: string
  paragraphs: string[] // with **bold** and *italic* marks
  html: string
  text: string
  tags: string[]
  meta: string
  slug: string
  warnings: string[]
  kind: Kind
  category: string
  people: Person[]
}

const slugOf = (h: string) =>
  h
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-[^-]*$/, (m) => (m.length < 4 ? '' : m))

/** Puts the story together from the AI's parts (pure, for tests). */
export function assemble(ai: AiOut, raw: string, now = Date.now(), force?: Kind): PressStory {
  const { city, date } = datelineFrom(raw, now)
  const quotes = quotesIn(raw)
  const warnings: string[] = []
  const kind: Kind = force && force !== 'guest' ? force : isKind(ai.category) && ai.category !== 'guest' ? ai.category : 'news'
  const appointees = (ai.appointees ?? []).map((a) => ({ name: tidy(a.name).replace(/^(Mr|Mrs|Ms|Dr|Shri|Smt)\.?\s+/i, ''), designation: tidy(a.designation) })).filter((a) => a.name.length > 2)
  // If the AI did not name the appointee, read it from "has appointed <Name> as <Designation>".
  if (kind === 'leadership' && !appointees.length) {
    const m = /appoint(?:ed|s|ment of)\s+(?:(?:Mr|Ms|Mrs|Dr)\.?\s+)?([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3})\s+as\s+(?:its\s+|the\s+)?([^,.;]+)/.exec(tidy(ai.lead))
    if (m) appointees.push({ name: m[1], designation: m[2].trim() })
  }
  let lead = tidy(ai.lead).replace(/^[A-Z][A-Za-z .]+,\s*[A-Z][a-z]+ \d{1,2}, \d{4}:\s*/, '')
  // Appointments read "…, according to a press release." on the site; other news "a company press release".
  if (lead && !/according to/i.test(lead)) lead = lead.replace(/\.$/, '') + (kind === 'leadership' ? ', according to a press release.' : ', according to a company press release.')
  if (kind === 'leadership') lead = lead.replace(/according to a company press release/i, 'according to a press release')
  // The new appointee's name is in bold in the lead.
  for (const a of appointees) if (!lead.includes(`**${a.name}**`)) lead = lead.replace(a.name, `**${a.name}**`)
  const people: Person[] = appointees.map((a) => ({ name: a.name, designation: a.designation, company: '', role: 'appointee' as const }))
  const quoteParas: string[] = []
  for (const q of ai.quotes ?? []) {
    const text = quotes[(q.n ?? 1) - 1]
    if (!text || !tidy(q.name)) continue
    const name = tidy(q.name).replace(/^(Mr|Mrs|Ms|Dr|Shri|Smt)\.?\s+/i, '')
    const who = [`**${name}**`, tidy(q.designation), tidy(q.company) ? `**${tidy(q.company)}**` : ''].filter(Boolean).join(', ')
    if (!people.some((p) => p.name === name)) people.push({ name, designation: tidy(q.designation), company: tidy(q.company), role: 'speaker' })
    const intro = tidy(q.intro).replace(/,?$/, ',')
    quoteParas.push(`${intro && intro !== ',' ? `${intro} ` : ''}${who}, said, “${text}”`.replace(/^([a-z])/, (m) => m.toUpperCase()))
  }
  if (quotes.length && !quoteParas.length) warnings.push('There is a quote in the file, but it was not placed. Add the spokesperson paragraph by hand.')
  const paragraphs = [lead, ...(ai.before ?? []).map(tidy), ...quoteParas, ...(ai.after ?? []).map(tidy)].filter((p) => p.length > 20)
  if (paragraphs.length) paragraphs[0] = `**${city}, ${date}:** ${paragraphs[0]}`
  const all = [...new Set((ai.headlines ?? []).map((h) => tidy(h).replace(/^["“]|["”]$/g, '').replace(/\.$/, '')).filter(Boolean))]
  const headlines = [...all.filter(goodLength), ...all.filter((h) => !goodLength(h))].slice(0, 3)
  const body = paragraphs.map(plain).join(' ')
  const odd = unknownNumbers(`${headlines.join(' ')} ${body.replace(`${city}, ${date}:`, '')}`, raw)
  if (odd.length) warnings.push(`Check these numbers; they are not in the file sent: ${odd.join(', ')}`)
  if (!headlines.length) warnings.push('No headline came back. Write one by hand.')
  const slug = slugOf(headlines[0] ?? '')
  return {
    headlines,
    dateline: `${city}, ${date}:`,
    paragraphs,
    html: paragraphs.map((p) => `<p>${inline(p)}</p>`).join('\n\n'),
    text: paragraphs.map(plain).join('\n\n'),
    tags: (ai.tags ?? []).map(tidy).filter(Boolean).slice(0, 8),
    meta: tidy(ai.meta).slice(0, 160),
    slug,
    warnings,
    kind,
    category: CATEGORIES[kind],
    people,
  }
}

/* ---------- guest columns ---------- */

const DISCLAIMER = '**Disclaimer: Views expressed in this article are those of the author, and not necessarily of Realtynmore.com.**'
/** A short line with no full stop: a subheading in the author's article. */
const isSubhead = (l: string) => l.length >= 4 && l.length <= 90 && l.split(' ').length <= 14 && !/[.,;"”']$/.test(l) && !/^[•\-–*]/.test(l)

/** Title, byline lines and body of a guest column; stops at "About the author" and the like. */
export function guestParts(raw: string): { title: string; byline: string[]; body: string[] } {
  const lines = raw.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const end = lines.findIndex((l, i) => i > 2 && /^(about the (author|writer|columnist)|author'?s? (bio|profile|note)|disclaimer|views expressed|\(the (author|writer) is)/i.test(l))
  const all = end > 0 ? lines.slice(0, end) : lines
  let i = 0
  const title = all[0] && all[0].length < 170 ? all[i++] : ''
  const byline: string[] = []
  // Name, designation and company lines (or "By …") under the title, before the first real paragraph.
  while (i < all.length && byline.length < 4 && all[i].length < 120 && (!/[.!?]["”]?$/.test(all[i]) || /^(by|written by|authored by)\b/i.test(all[i]))) byline.push(all[i++])
  return { title, byline, body: all.slice(i) }
}

/** Puts a guest column together (pure, for tests). */
export function assembleGuest(ai: { headlines?: string[]; author?: { name?: string; designation?: string; company?: string }; tags?: string[]; meta?: string }, raw: string): PressStory {
  const { title, byline, body } = guestParts(raw)
  const warnings: string[] = []
  const name = tidy(ai.author?.name).replace(/^(by|written by|authored by)\s+/i, '').replace(/^(Mr|Mrs|Ms|Dr|Shri|Smt)\.?\s+/i, '')
  const author: Person = { name, designation: tidy(ai.author?.designation), company: tidy(ai.author?.company), role: 'author' }
  // Lines that only repeat the author's name (often at the end) are not part of the article.
  const lower = name.toLowerCase()
  const kept = body.filter((l) => !(lower && l.length < 120 && l.toLowerCase().replace(/^(by|written by|authored by)\s+/, '').startsWith(lower)))
  if (!name) warnings.push('The author’s name was not found. Add the “By Name, Designation, Company” line by hand.')
  if (!byline.length && !name) warnings.push('Check the start of the article; the title or byline could not be told apart from the text.')
  const paragraphs = [
    ...(name ? [`***By ${[author.name, author.designation, author.company].filter(Boolean).join(', ')}***`] : []),
    ...kept.map((l) => (isSubhead(l) ? `**${l.replace(/:$/, '')}**` : l)),
    DISCLAIMER,
  ]
  const fromAi = (ai.headlines ?? []).map((h) => tidy(h).replace(/^["“]|["”]$/g, '').replace(/\.$/, '')).filter(Boolean)
  // The author's own title comes first; the AI's options only if they are full headlines.
  const own = title ? [title.replace(/\.$/, '')] : []
  const headlines = [...new Set([...own, ...fromAi.filter((h) => h.length >= 35), ...(own.length ? [] : fromAi)])].slice(0, 3)
  if (!headlines.length) warnings.push('No headline came back. Write one by hand.')
  return {
    headlines,
    dateline: '',
    paragraphs,
    html: paragraphs.map((p) => `<p>${inline(p)}</p>`).join('\n\n'),
    text: paragraphs.map(plain).join('\n\n'),
    tags: (ai.tags ?? []).map(tidy).filter(Boolean).slice(0, 8),
    meta: tidy(ai.meta).slice(0, 160),
    slug: slugOf(headlines[0] ?? ''),
    warnings,
    kind: 'guest',
    category: CATEGORIES.guest,
    people: name ? [author] : [],
  }
}

const GUEST_RULES = `You prepare guest columns (articles written by industry experts) for Realty & More (realtynmore.com), an Indian real estate publication. The article itself is published as the author wrote it; you only give:
- "headlines": 3 options, Title Case, 45 to 100 characters. If the author's title is good, the first option is that title with grammar and capitals fixed. A colon or a question is fine. No hype words. Real examples:
   - Beyond Plot Ownership: Why the Future of Real Estate Lies in Integrated Community Living
   - The New Density Debate: Can India’s Cities Build More Homes Without Compromising Liveability?
   - The Rise of Home Elevators in Luxury Villas & Bungalows
- "author": the writer's name (no Mr./Ms./Dr.), designation and company, exactly as given in the text. Empty strings if not given.
- "tags": 4 to 8 topics. "meta": one sentence summary, at most 155 characters.
Never invent names or facts. Reply with JSON only: {"headlines":["","",""],"author":{"name":"","designation":"","company":""},"tags":[""],"meta":""}`

/** Real realtynmore.com headlines, the target style. */
const GOOD_HEADLINES = [
  'G Square Group and JSW One Homes Partner to Streamline Turnkey Villa Construction',
  'Indian Corporates Drive Next Phase of Workspace Growth as Flex Demand Reaches Record High: myHQ',
  'WeWork India Reports 31.6% Revenue Growth in Q2 FY27 Amid Record Capacity Expansion',
  'Brigade Group And Hyatt Announce Plans For Two New Hyatt Regency Hotels In Bengaluru',
  'Bajel Projects Secures Record Rs 1,500 Crore Transmission Order For Renewable Energy',
  'LML Realty Establishes In-House Ready-Mix Concrete Facility at Haryana Industrial Park',
]
/** Too short to say who did what: the desk's headlines run about 55 to 95 characters. */
export const goodLength = (h: string) => h.length >= 45 && h.length <= 110

const LEADERSHIP_HEADLINES = [
  'WSB Real Estate Partners Appoints Akash Rastogi as Managing Partner',
  'Terray Realty Strengthens Leadership Team with Two Senior Appointments',
  'Canonicus Capital Appoints Rajan Gupta as Managing Director Following Deployment of 75% Corpus',
]

const RULES = `You edit press releases into news stories for Realty & More (realtynmore.com), an Indian real estate news publication. Follow the desk's house style exactly:
0. CATEGORY: one of "leadership" (an appointment, promotion, new CEO/director/brand ambassador), "report" (a research report, survey or data study), "launch" (a new project launch), "rera" (RERA authority news), "event" (an event, conclave or award), or "news" (anything else). For "leadership" also list "appointees" (name without Mr./Ms. and the new designation). Leadership headlines look like:
${LEADERSHIP_HEADLINES.map((h) => `   - ${h}`).join('\n')}
   and the lead reads "<Company>, a <short description>, has appointed <Name> as <Designation> …".
1. HEADLINES: 3 options. New wording (do not copy the release headline). Title Case, 55 to 95 characters (never shorter than 50), says who did what and why it matters, keeps the key number if there is one. Style examples:
${GOOD_HEADLINES.map((h) => `   - ${h}`).join('\n')}
   No hype words (largest, leading, premium, iconic). For a report or survey, end with ": <Source>" (e.g. "Indian Corporates Drive Next Phase of Workspace Growth as Flex Demand Reaches Record High: myHQ").
2. LEAD: one or two sentences, rewritten, with the main news first. Do NOT write the city or date. End with ", according to a company press release." (for a report: "…, according to the <Report Name> report released by <Source> in a press release.").
3. BEFORE: 1 or 2 short paragraphs (2 to 4 sentences each) with the key facts, in your own words, not copied. Keep every number exactly as written. Spell out an abbreviation the first time (BFSI, GCC, SME, MNC). Change claims like "India's largest" or "leading" into neutral wording such as "a leading <type> in India" or drop them.
4. QUOTES: say whose quote each numbered quote is. Do not rewrite or repeat the quote text. "intro" is a short lead-in such as "Commenting on the partnership," or "Commenting on the contract win," (empty for a report). Drop titles like Mr., Ms., Dr.
5. AFTER: 1 short closing paragraph with remaining project details, timelines or the study's method. Nothing from "About the company", media contacts, tables or order-size classifications.
6. Wrap a report or study name in *single stars* (italics). Never invent facts, numbers, names or dates.
7. TAGS: 4 to 8 tags (company names, people, places, topics). META: one sentence summary, at most 155 characters.
Reply with JSON only, no other text:
{"category":"news","appointees":[],"headlines":["",""," "],"lead":"","before":[""],"quotes":[{"n":1,"intro":"","name":"","designation":"","company":""}],"after":[""],"tags":[""],"meta":""}`

const EXAMPLE_IN = `L&T Wins Orders (Major*) for Dhaka Metro
New Delhi, October 27, 2026: The Transportation Infrastructure business vertical of L&T has secured major Design & Build orders for two key systems packages of the Dhaka Mass Rapid Transit Development Project (Line 1), that is Dhaka Metro, in Bangladesh.
The orders comprise Contract Package CP09 - Track Works & Electrical Systems, and Contract Package CP10 - Signalling, Telecommunications & Platform Screen Doors (PSD). These pertain to the first underground metro project in Bangladesh.
Prior to this L&T had won and delivered the integrated railway systems package for Dhaka Metro Line 6, Bangladesh's first metro rail corridor, which is currently in commercial operation.
Commenting on this, Ramkumar S, Senior Vice President & Head – Transportation Infrastructure, L&T, said: [quote 1]
The Dhaka Metro Line 1 project, funded by the Japan International Cooperation Agency (JICA), will provide a modern mass transit system spanning approximately 31 km. It includes the Airport Route from Kamalapur to Airport and the Purbachal Route from Natun Bazar to Purbachal Terminal, with 19 stations and a depot at Pitalganj.
Under CP09, L&T, along with its Japanese partner M/s Sumitomo Corporation, will undertake the design, procurement, installation, testing and commissioning of the complete track works, power supply & distribution system, traction substations, overhead catenary system and associated electrical facilities across the corridor. Under CP10, L&T will execute the signalling, telecommunication and platform screen door for the entire network.`
const EXAMPLE_OUT = `{"category":"news","appointees":[],"headlines":["L&T Secures Major Dhaka Metro Line 1 System Contracts","L&T Wins Track, Power and Signalling Packages for Dhaka Metro Line 1","L&T Bags Two Systems Packages for Bangladesh's First Underground Metro"],"lead":"The Transportation Infrastructure business vertical of L&T has secured major Design & Build orders for two key systems packages of the Dhaka Mass Rapid Transit Development Project (Line 1) in Bangladesh, according to a company press release.","before":["The contracts cover Package CP09 for track works and electrical systems, and Package CP10 for signalling, telecommunications, and platform screen doors. The project marks the development of Bangladesh's first underground metro system. Prior to this, L&T delivered the integrated railway systems package for Dhaka Metro Line 6, which is currently operational."],"quotes":[{"n":1,"intro":"Commenting on the contract win,","name":"Ramkumar S","designation":"Senior Vice President & Head – Transportation Infrastructure","company":"L&T"}],"after":["Funded by the Japan International Cooperation Agency (JICA), the Dhaka Metro Line 1 project spans approximately 31 kilometers. The route comprises the Airport Route connecting Kamalapur to the Airport and the Purbachal Route linking Natun Bazar to the Purbachal Terminal, featuring 19 stations and a depot at Pitalganj.","Under the CP09 package, L&T and its partner Sumitomo Corporation will handle the design, procurement, installation, testing, and commissioning of track works, power supply, traction substations, and overhead catenary systems. For CP10, L&T will execute the signalling, telecommunication, and platform screen door systems across the entire network."],"tags":["L&T","Dhaka Metro","Bangladesh","Metro Rail","JICA","Sumitomo Corporation","Infrastructure"],"meta":"L&T has won the track, electrical, signalling and platform screen door packages for Dhaka Metro Line 1, Bangladesh's first underground metro."}`

function parseJson(out: string): AiOut | null {
  const s = out.indexOf('{')
  const e = out.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  try {
    return JSON.parse(out.slice(s, e + 1)) as AiOut
  } catch {
    return null
  }
}

async function runAi(env: Env, model: string, user: string): Promise<string> {
  const messages = [
    { role: 'system', content: RULES },
    { role: 'user', content: `Release:\n${EXAMPLE_IN}\n\nQuotes:\n[1] "The repeat orders from Dhaka Mass Transit Company Limited (DMTCL) are a testament to L&T's capabilities…"` },
    { role: 'assistant', content: EXAMPLE_OUT },
    { role: 'user', content: user },
  ]
  const out = (await env.AI.run(model as Parameters<Ai['run']>[0], { messages, max_tokens: 1400, temperature: 0.2 } as never)) as { response?: string | object; choices?: { message?: { content?: string } }[] }
  const r = out.response ?? out.choices?.[0]?.message?.content ?? ''
  return typeof r === 'string' ? r : JSON.stringify(r)
}

async function runGuest(env: Env, model: string, raw: string): Promise<string> {
  const { title, byline } = guestParts(raw)
  const text = `Title: ${title}\nUnder the title: ${byline.join(' | ') || '(nothing)'}\n\nStart of the article:\n${raw.slice(0, 1600)}\n\nEnd of the article:\n${raw.slice(-1000)}`
  const messages = [
    { role: 'system', content: GUEST_RULES },
    { role: 'user', content: text },
  ]
  const out = (await env.AI.run(model as Parameters<Ai['run']>[0], { messages, max_tokens: 500, temperature: 0.2 } as never)) as { response?: string | object; choices?: { message?: { content?: string } }[] }
  const r = out.response ?? out.choices?.[0]?.message?.content ?? ''
  return typeof r === 'string' ? r : JSON.stringify(r)
}

async function runHeadlines(env: Env, story: string): Promise<string> {
  const messages = [
    { role: 'system', content: 'You write news headlines for Realty & More, an Indian real estate publication. Reply with JSON only: {"headlines":["","",""]}' },
    {
      role: 'user',
      content: `Write 3 headlines for this story. Each 60 to 95 characters, Title Case, says who did what and why it matters, keeps the key number, no hype words, no full stop. Match these real examples:
${GOOD_HEADLINES.join('\n')}

Story:
${story.slice(0, 2500)}`,
    },
  ]
  const out = (await env.AI.run(MODEL as Parameters<Ai['run']>[0], { messages, max_tokens: 300, temperature: 0.4 } as never)) as { response?: string | object; choices?: { message?: { content?: string } }[] }
  const r = out.response ?? out.choices?.[0]?.message?.content ?? ''
  return typeof r === 'string' ? r : JSON.stringify(r)
}

/** Turns a press release into a story and keeps it as a draft for the desk. */
export async function pressToStory(env: Env, body: unknown, who: Who) {
  const b = (body ?? {}) as { text?: unknown; source?: unknown; kind?: unknown }
  const raw = typeof b.text === 'string' ? b.text.trim() : ''
  const forced = isKind(b.kind) ? b.kind : undefined
  if (raw.length < 200) throw new Error('Add the text (upload the Word or PDF file, or paste it).')
  const day = istToday().toISOString().slice(0, 10)
  const used = await env.DB.prepare("INSERT INTO ai_usage (day, who, n) VALUES (?, 'team', 1) ON CONFLICT(day, who) DO UPDATE SET n = n + 1 RETURNING n").bind(day).first<{ n: number }>()
  if ((used?.n ?? 1) > 150) throw new Error('Today’s free AI quota for the team is used up. Try again tomorrow.')
  const source = typeof b.source === 'string' ? b.source.slice(0, 120) : 'Pasted text'
  if (forced === 'guest' || (!forced && looksLikeGuest(raw))) {
    let g = null as Parameters<typeof assembleGuest>[0] | null
    for (const model of [MODEL, BACKUP]) {
      try {
        g = parseJson(await runGuest(env, model, raw)) as Parameters<typeof assembleGuest>[0] | null
        if (g?.headlines?.length) break
      } catch {
        /* try the next model */
      }
    }
    return saveDraft(env, assembleGuest(g ?? {}, raw.slice(0, 30000)), source, who)
  }
  const clean = cleanRelease(raw)
  const quotes = quotesIn(clean)
  const hint = forced ? `\n\n(This is a "${forced}" story.)` : ''
  const user = `Release:\n${clean.replace(/[“"][^“”"]{40,}[”"]/g, (m) => `[quote ${quotes.indexOf(m.slice(1, -1).trim()) + 1}]`)}\n\nQuotes:\n${quotes.map((q, i) => `[${i + 1}] "${q.slice(0, 160)}…"`).join('\n') || '(none)'}${hint}`
  let ai: AiOut | null = null
  for (const model of [MODEL, BACKUP]) {
    try {
      ai = parseJson(await runAi(env, model, model === BACKUP ? `${user} /no_think` : user))
      if (ai?.lead) break
    } catch {
      /* try the next model */
    }
  }
  if (!ai?.lead) throw new Error('The AI could not read this file. Try again, or paste just the main text.')
  // Short headlines miss the house style; ask once more for headlines only.
  if ((ai.headlines ?? []).filter((h) => goodLength(h.trim())).length < 2) {
    try {
      const more = parseJson(
        await runHeadlines(env, `${ai.lead} ${(ai.before ?? []).join(' ')}`),
      )?.headlines
      ai.headlines = [...(ai.headlines ?? []).filter((h) => goodLength(h.trim())), ...(more ?? []).filter((h) => goodLength(h.trim())), ...(ai.headlines ?? [])].slice(0, 3)
    } catch {
      /* keep what we have */
    }
  }
  return saveDraft(env, assemble(ai, clean, Date.now(), forced), source, who)
}

async function saveDraft(env: Env, story: PressStory, source: string, who: Who) {
  const r = await env.DB.prepare('INSERT INTO pr_drafts (title, source, story, by_name, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(story.headlines[0] ?? 'Untitled', source, JSON.stringify(story), who.name, new Date().toISOString())
    .run()
  return { id: r.meta.last_row_id, ...story, images: [] }
}

export async function listDrafts(env: Env) {
  const { results } = await env.DB.prepare('SELECT id, title, source, by_name AS byName, created_at AS created FROM pr_drafts ORDER BY id DESC LIMIT 40').all()
  return { drafts: results }
}

export async function getDraft(env: Env, id: number) {
  const r = await env.DB.prepare('SELECT id, source, story, by_name AS byName, created_at AS created FROM pr_drafts WHERE id = ?').bind(id).first<{ id: number; source: string; story: string; byName: string; created: string }>()
  if (!r) throw new Error('Draft not found.')
  const { results: images } = await env.DB.prepare('SELECT n, role, person, name, type, w, h FROM pr_images WHERE draft_id = ? ORDER BY n').bind(id).all()
  const story = JSON.parse(r.story) as Partial<PressStory>
  // Drafts made before story types existed are news stories.
  return { id: r.id, source: r.source, byName: r.byName, created: r.created, kind: 'news', category: CATEGORIES.news, people: [], ...story, images }
}

/* ---------- photos kept with a draft ---------- */

export const IMAGE_ROLES = ['featured', 'photo', 'headshot', 'skip'] as const
const MAX_IMAGE = 3 * 1024 * 1024

/** Saves one photo for a draft (raw body; details in the query string). */
export async function savePressImage(env: Env, req: Request, url: URL) {
  const draft = Number(url.searchParams.get('draft'))
  const n = Number(url.searchParams.get('n'))
  if (!Number.isInteger(draft) || draft <= 0 || !Number.isInteger(n) || n < 1 || n > 12) throw new Error('Pick a draft.')
  if (!(await env.DB.prepare('SELECT id FROM pr_drafts WHERE id = ?').bind(draft).first())) throw new Error('Draft not found.')
  const type = req.headers.get('Content-Type') ?? ''
  if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new Error('Photos must be JPG, PNG or WebP.')
  const body = await req.arrayBuffer()
  if (!body.byteLength || body.byteLength > MAX_IMAGE) throw new Error('Photos up to 3 MB each.')
  const role = (IMAGE_ROLES as readonly string[]).includes(url.searchParams.get('role') ?? '') ? url.searchParams.get('role')! : 'photo'
  await env.SUBS.put(`pr:img:${draft}:${n}`, body)
  await env.DB.prepare('INSERT OR REPLACE INTO pr_images (draft_id, n, role, person, name, type, w, h, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(draft, n, role, tidy(url.searchParams.get('person')).slice(0, 80), tidy(url.searchParams.get('name')).slice(0, 120), type, Number(url.searchParams.get('w')) || 0, Number(url.searchParams.get('h')) || 0, body.byteLength)
    .run()
  return { ok: true }
}

export async function setImageRole(env: Env, body: unknown) {
  const b = (body ?? {}) as { draft?: unknown; n?: unknown; role?: unknown; person?: unknown }
  if (!(IMAGE_ROLES as readonly string[]).includes(String(b.role))) throw new Error('Pick where the photo goes.')
  await env.DB.prepare('UPDATE pr_images SET role = ?, person = ? WHERE draft_id = ? AND n = ?').bind(String(b.role), tidy(b.person).slice(0, 80), Number(b.draft), Number(b.n)).run()
  return { ok: true }
}

export async function pressImage(env: Env, url: URL, headers: Record<string, string>): Promise<Response> {
  const draft = Number(url.searchParams.get('draft'))
  const n = Number(url.searchParams.get('n'))
  const row = await env.DB.prepare('SELECT type FROM pr_images WHERE draft_id = ? AND n = ?').bind(draft, n).first<{ type: string }>()
  const data = row ? await env.SUBS.get(`pr:img:${draft}:${n}`, 'arrayBuffer') : null
  if (!row || !data) return new Response('Not found', { status: 404, headers })
  return new Response(data, { headers: { ...headers, 'Content-Type': row.type, 'Cache-Control': 'private, max-age=86400' } })
}

export async function removeDraft(env: Env, body: unknown) {
  const id = Number((body as { id?: unknown })?.id)
  if (!Number.isInteger(id) || id <= 0) throw new Error('Pick a draft.')
  const { results } = await env.DB.prepare('SELECT n FROM pr_images WHERE draft_id = ?').bind(id).all<{ n: number }>()
  await Promise.all(results.map((r) => env.SUBS.delete(`pr:img:${id}:${r.n}`)))
  await env.DB.batch([env.DB.prepare('DELETE FROM pr_images WHERE draft_id = ?').bind(id), env.DB.prepare('DELETE FROM pr_drafts WHERE id = ?').bind(id)])
  return { ok: true }
}
