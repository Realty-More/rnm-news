// "Key points" in the Axios Smart Brevity style, picked from the story's own sentences.
// Nothing is rewritten or made up: every point is a sentence the reporter wrote, quoted as is.
import { decodeEntities } from './format.ts'

const ABBR = /\b(Rs|Mr|Ms|Mrs|Dr|Ltd|Pvt|Co|No|vs|Sr|Jr|St|Inc|Corp|approx|Govt|Dept|Prof|Hon)\.\s/g
const BYLINE = /^By [A-Z][a-z]+ [A-Z]/
const BOILERPLATE = /^(about |for more|disclaimer|also read|read more|follow us|click here|this article|note:|image:|photo:|source:|©|subscribe)/i
const DATELINE = /^[A-Z][A-Za-z .()-]{2,40},\s*(?:[A-Z][a-z]+\.?\s+\d{1,2}|\d{1,2}\s+[A-Z][a-z]+)(?:,?\s*\d{4})?\s*[:\-–—]\s*/
const FIGURES = /%|\bcrore\b|\blakh\b|\bbillion\b|\bmillion\b|\bsq\.?\s?ft\b|square feet|\bacres?\b|\bunits\b|₹|\bRs\b|\bINR\b|\bbps\b|year-on-year|\by-o-y\b|\bQ[1-4]\b|\bquarter\b/i

/** Article HTML → plain paragraphs of text. */
export function htmlToText(html: string): string[] {
  const text = html
    .replace(/<(script|style|figure|figcaption|table)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(text)
    .split('\n')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** Splits a paragraph into sentences without breaking "Rs. 949" or "23.7". */
export function sentences(paragraph: string): string[] {
  const guarded = paragraph.replace(ABBR, (_m, a: string) => `${a}.\u0000`)
  return guarded
    .split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(₹A-Z0-9])/)
    .map((s) => s.replace(/\u0000/g, ' ').trim())
    .filter(Boolean)
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? [])
function overlap(a: string, b: string): number {
  const A = words(a)
  const B = words(b)
  let same = 0
  for (const w of A) if (B.has(w)) same++
  return same / Math.max(1, Math.min(A.size, B.size))
}

/**
 * Up to `max` sentences that carry the story: the lede plus the ones with the hard numbers.
 * Returns [] for short pieces, where a summary would only repeat the story.
 */
export function keyPoints(html: string, max = 3): string[] {
  const all = htmlToText(html).flatMap(sentences)
  const candidates = all
    .map((raw, i) => ({ text: raw.replace(DATELINE, '').trim(), i }))
    .filter(({ text }) => text.length >= 50 && text.length <= 280 && !BOILERPLATE.test(text) && !BYLINE.test(text) &&/[.!?]["”’)]?$/.test(text))
  if (candidates.length < 5) return []
  const n = all.length
  const scored = candidates.map((c) => {
    let score = 1 - c.i / n
    if (c.i === 0) score += 2
    if (/\d/.test(c.text)) score += 2
    if (FIGURES.test(c.text)) score += 2
    if (/[“”"]/.test(c.text) || /\b(said|added|stated)\b/i.test(c.text)) score -= 1.5
    return { ...c, score }
  })
  const picked: typeof scored = []
  for (const c of [...scored].sort((a, b) => b.score - a.score)) {
    if (picked.length >= max) break
    if (picked.some((p) => overlap(p.text, c.text) > 0.6)) continue
    picked.push(c)
  }
  return picked.sort((a, b) => a.i - b.i).map((p) => p.text)
}
