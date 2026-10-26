// "Ask R&M" (readers) and the AI writer (team), on Cloudflare Workers AI's free daily allowance.
//   Readers: answers come only from realtynmore.com stories found for the question, with numbered
//   sources; no outside facts, no investment advice. Limits per device and per day keep it free.
//   Team: rewrite tools (headlines, meta descriptions, captions, Hindi) on a stronger model.
import { decode } from './site.ts'
import type { Env } from './index.ts'
import type { Who } from './owner.ts'

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RM-News-App/1.0)' }
const READER_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'
const FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8'
const WRITER_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const PER_DEVICE = 20
const PER_DAY = 400
const TEAM_PER_DAY = 150

const STOP = new Set(
  'a an the and or but of in on at to for from by with about into over under is are was were be been being do does did what which who whom whose when where why how this that these those it its as any all some can could will would should may might me my we our you your they their he she his her i hi hello please tell explain give show latest news today new story stories about kya hai hain ka ki ke ko mein me se aur ya bhi koi kaun kab kaise kyu kyun batao bataiye'.split(' '),
)

/** Content words of a question, most specific first (longer words tend to be names and topics). */
export function keywords(q: string, max = 4): string[] {
  const words = (q.toLowerCase().match(/[a-z0-9][a-z0-9&.-]*/g) ?? []).map((w) => w.replace(/[.-]+$/, '')).filter((w) => w.length > 2 && !STOP.has(w))
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, max)
}

interface Story { id: number; title: string; link: string; date: string; text: string }

const strip = (html: string) => decode(html.replace(/<(script|style|figure)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

async function wp(env: Env, query: string): Promise<Story[]> {
  try {
    const res = await fetch(`${env.SITE_API}/posts?${query}&_fields=id,title,link,date_gmt,excerpt,content`, { headers: UA })
    if (!res.ok) return []
    const rows = (await res.json()) as { id: number; title: { rendered: string }; link: string; date_gmt: string; excerpt: { rendered: string }; content: { rendered: string } }[]
    return rows.map((r) => ({ id: r.id, title: decode(r.title.rendered), link: r.link, date: `${r.date_gmt}Z`, text: strip(r.content.rendered || r.excerpt.rendered) }))
  } catch {
    return []
  }
}

/** Stories that may answer the question: a search on its key words, plus the latest headlines. */
export async function findStories(env: Env, q: string, postId?: number): Promise<Story[]> {
  if (postId) return wp(env, `include=${postId}`)
  const kw = keywords(q)
  const searches = [kw.slice(0, 2).join(' '), ...kw.slice(0, 3)].filter(Boolean)
  const lists = await Promise.all([...[...new Set(searches)].map((s) => wp(env, `search=${encodeURIComponent(s)}&per_page=4`)), wp(env, 'per_page=5')])
  const seen = new Set<number>()
  const out: Story[] = []
  for (const s of lists.flat()) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
  }
  return out.slice(0, 8)
}

const SYSTEM = `You are "Ask R&M", the assistant in the Realty & More news app (Indian real estate news by RealtyNMore).
Rules:
1. Use ONLY the numbered stories given. Never add facts, numbers, names or dates that are not in them.
2. If the stories do not answer the question, say so in one sentence and suggest a search term.
3. No investment, legal or tax advice and no price predictions. You may explain what a story reports.
4. After each sentence that uses a story, cite it like [2].
5. Be brief: at most 5 short sentences or bullet points. Plain, simple words.
6. Reply in the user's language: English, Hindi (Devanagari) or Hinglish, matching the question.`

/** Strips model "thinking" and keeps only citations that point at a real source. */
export function cleanAnswer(raw: string, sources: number): { text: string; cited: number[] } {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^<think>[\s\S]*$/i, '')
    .replace(/\[(\d+)\]/g, (m, n) => (Number(n) >= 1 && Number(n) <= sources ? m : ''))
    .trim()
  const cited = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
  return { text, cited }
}

async function bump(env: Env, day: string, who: string): Promise<number> {
  const r = await env.DB.prepare('INSERT INTO ai_usage (day, who, n) VALUES (?, ?, 1) ON CONFLICT(day, who) DO UPDATE SET n = n + 1 RETURNING n').bind(day, who).first<{ n: number }>()
  return r?.n ?? 1
}

async function run(env: Env, model: string, messages: { role: string; content: string }[], maxTokens: number): Promise<string> {
  const out = (await env.AI.run(model as Parameters<Ai['run']>[0], { messages, max_tokens: maxTokens, temperature: 0.2 } as never)) as { response?: string; choices?: { message?: { content?: string } }[] }
  return out.response ?? out.choices?.[0]?.message?.content ?? ''
}

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')

export async function ask(env: Env, req: Request, body: unknown, ctx: ExecutionContext) {
  const b = (body ?? {}) as { q?: unknown; postId?: unknown; history?: unknown }
  const q = typeof b.q === 'string' ? b.q.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  if (q.length < 3) throw new Error('Type a question.')
  const postId = Number.isInteger(b.postId) ? (b.postId as number) : undefined
  const day = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)

  // Same question about the same story today: answer from the edge cache (free, instant).
  const cacheKey = new Request(`https://ai.cache/${day}/${postId ?? 0}/${encodeURIComponent(q.toLowerCase())}`)
  const hit = await caches.default.match(cacheKey)
  if (hit) return hit.json()

  const device = await sha(`${req.headers.get('CF-Connecting-IP') ?? 'x'}|${day}`)
  if ((await bump(env, day, 'all')) > PER_DAY) throw new Error('The assistant has answered its free quota for today. Please try again tomorrow, or use Search.')
  if ((await bump(env, day, `ip:${device}`)) > PER_DEVICE) throw new Error('You have reached today’s limit of questions. Please try again tomorrow.')

  const stories = await findStories(env, q, postId)
  if (!stories.length) return { answer: 'I could not find a RealtyNMore story on that yet. Try Search with a company, city or project name.', sources: [] }
  const per = postId ? 6000 : 1100
  const context = stories.map((s, i) => `[${i + 1}] ${s.title} (${s.date.slice(0, 10)})\n${s.text.slice(0, per)}`).join('\n\n')
  // Earlier turns of this chat (questions and answers only), so follow-ups make sense.
  const history = Array.isArray(b.history)
    ? (b.history as { role?: unknown; content?: unknown }[])
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-4)
        .map((m) => ({ role: m.role as string, content: (m.content as string).slice(0, 600) }))
    : []
  const messages = [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content: `Stories:\n${context}\n\nQuestion: ${q} /no_think` }]
  let raw = ''
  try {
    raw = await run(env, READER_MODEL, messages, 450)
  } catch {
    raw = await run(env, FALLBACK_MODEL, messages, 400)
  }
  const { text, cited } = cleanAnswer(raw, stories.length)
  if (!text) throw new Error('The assistant could not answer that. Please rephrase.')
  const sources = (cited.length ? cited : postId ? [1] : []).map((n) => ({ n, id: stories[n - 1].id, title: stories[n - 1].title, link: stories[n - 1].link }))
  const result = { answer: text, sources }
  ctx.waitUntil(caches.default.put(cacheKey, new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=21600' } })))
  return result
}

/* ---------- team writer ---------- */

const TASKS: Record<string, string> = {
  headlines:
    'Write 5 different complete news headlines for this story. Each one is 45 to 65 characters, in title case, says what happened (who did what, with the key number), factual, no clickbait, no exclamation marks. Example style: "DLF Buys 7.48 Acres on Golf Course Extension Road, Gurugram". One per line, numbered.',
  meta: 'Write 2 SEO meta descriptions for this story, each 140 to 155 characters, factual, with the main keyword early. One per line, numbered.',
  instagram: 'Write an Instagram caption for this story: a strong first line, 3 short lines of facts from the story, a question for comments, then at most 5 relevant hashtags. No emojis.',
  linkedin: 'Write a LinkedIn post for this story: 4 to 6 short lines, professional tone, facts only from the story, end with one line on why it matters for the real estate industry. At most 3 hashtags.',
  whatsapp: 'Write a WhatsApp channel post for this story: bold headline line using *asterisks*, 3 bullet facts, and a closing line "Read more on Realty & More".',
  summary: 'Summarise this story in 3 bullet points of one sentence each, keeping every number exactly as written.',
  hindi: 'Translate this text into simple, natural Hindi (Devanagari). Keep company names, numbers and units exactly as they are.',
  polish: 'Tighten this voiceover script for a 9:16 news reel: shorter sentences, natural spoken English, same order. Do NOT change, add or remove any number, name, date or fact.',
}

export async function write(env: Env, body: unknown, who: Who) {
  const b = (body ?? {}) as { task?: unknown; text?: unknown }
  const task = typeof b.task === 'string' && TASKS[b.task] ? b.task : null
  const text = typeof b.text === 'string' ? b.text.trim().slice(0, 8000) : ''
  if (!task) throw new Error('Pick what to write.')
  if (text.length < 40) throw new Error('Paste the story or script first (at least a few lines).')
  const day = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
  if ((await bump(env, day, 'team')) > TEAM_PER_DAY) throw new Error('Today’s free AI quota for the team is used up. Try again tomorrow.')
  const messages = [
    { role: 'system', content: 'You are an editor at Realty & More, an Indian real estate news publication. Use only facts from the text given; never invent numbers, names, quotes or dates. Output only the requested text, with no preamble.' },
    { role: 'user', content: `${TASKS[task]}\n\nText:\n${text}` },
  ]
  let out = ''
  try {
    out = await run(env, WRITER_MODEL, messages, 700)
  } catch {
    out = await run(env, READER_MODEL, [...messages.slice(0, 1), { role: 'user', content: `${messages[1].content} /no_think` }], 700)
  }
  return { text: cleanAnswer(out, 0).text, by: who.name }
}
