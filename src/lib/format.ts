// Text and date helpers. Pure functions so they run in tests and in the Node feed script.

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  rupee: '₹', laquo: '«', raquo: '»', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : match
    }
    return NAMED[code.toLowerCase()] ?? match
  })
}

export function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Plain-text summary; drops WordPress "[…]" / "Read more" tails. */
export function cleanExcerpt(html: string, max = 220): string {
  let text = stripHtml(html).replace(/\s*\[(…|&hellip;|\.\.\.)\]\s*$/, '').replace(/\s*(Read more|Continue reading).*$/i, '')
  if (text.length > max) text = text.slice(0, max).replace(/\s+\S*$/, '') + '…'
  return text
}

/** WordPress gives `date_gmt` without a zone suffix. */
export function gmtToIso(dateGmt: string): string {
  return /[zZ]|[+-]\d\d:\d\d$/.test(dateGmt) ? dateGmt : `${dateGmt}Z`
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${dateFmt.format(d)}, ${timeFmt.format(d)} IST`
}

/** "12 min ago" within a day, otherwise the IST date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  if (h < 48) return 'Yesterday'
  return formatDate(iso)
}

export function readingMinutes(html: string): number {
  const words = stripHtml(html).split(' ').filter(Boolean).length
  return Math.max(1, Math.round(words / 220))
}
