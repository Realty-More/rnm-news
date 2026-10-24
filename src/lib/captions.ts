// Ready-to-post social captions for a RealtyNMore story (rule-based, no paid AI).
// Text comes only from the story itself; hashtags are capped at 5.
import { CITIES } from './prefs.ts'
import type { Post } from './wp.ts'

const SECTION_TAGS: Record<string, string> = {
  rera: '#RERA',
  interviews: '#Interview',
  report: '#RealEstateData',
  launches: '#NewLaunch',
  'leadership-updates': '#Leadership',
  'guest-column': '#Opinion',
  blogs: '#HomeBuyers',
  'developer-speak': '#Developers',
  events: '#RealEstateEvents',
}

const COMPANIES: [RegExp, string][] = [
  [/\bDLF\b/, '#DLF'],
  [/\bGodrej Propert/i, '#GodrejProperties'],
  [/\b(Lodha|Macrotech)\b/i, '#Lodha'],
  [/\bOberoi Realty\b/i, '#OberoiRealty'],
  [/\bPrestige\b/i, '#Prestige'],
  [/\bPhoenix Mills\b/i, '#PhoenixMills'],
  [/\bSobha\b/i, '#Sobha'],
  [/\bBrigade\b/i, '#Brigade'],
  [/\bMahindra Lifespace/i, '#MahindraLifespaces'],
  [/\bSignature Global\b/i, '#SignatureGlobal'],
]

const cityTag = (city: string) => `#${city.replace(/\s+/g, '')}`

/** Up to `max` unique hashtags: #RealEstate, the section, a city, a company, then #RealtyNMore. */
export function hashtags(post: Pick<Post, 'title' | 'excerpt' | 'categories'>, max = 5): string[] {
  const text = `${post.title} ${post.excerpt}`
  const tags = ['#RealEstate']
  for (const c of post.categories) if (SECTION_TAGS[c.slug]) tags.push(SECTION_TAGS[c.slug])
  for (const city of CITIES) if (new RegExp(`\\b${city}\\b`, 'i').test(text) || (city === 'Gurugram' && /\bgurgaon\b/i.test(text))) tags.push(cityTag(city))
  for (const [re, tag] of COMPANIES) if (re.test(text)) tags.push(tag)
  tags.push('#RealtyNMore')
  const unique = [...new Set(tags)]
  // Always keep #RealtyNMore as the last tag.
  return [...unique.filter((t) => t !== '#RealtyNMore').slice(0, max - 1), '#RealtyNMore']
}

const clip = (s: string, n: number) => {
  const t = s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…'
  // Avoid doubled endings like "performance....".
  return t.replace(/[.…]{2,}$/, '…')
}

export interface Captions {
  instagram: string
  linkedin: string
  x: string
  whatsapp: string
}

export function captionsFor(post: Pick<Post, 'title' | 'excerpt' | 'categories'>, link: string): Captions {
  const tags = hashtags(post)
  const summary = clip(post.excerpt, 260)
  const instagram = `${post.title}\n\n${summary}\n\nFull story: link in bio.\n\n${tags.join(' ')}`
  const linkedin = `${post.title}\n\n${clip(post.excerpt, 600)}\n\nRead the full story on RealtyNMore: ${link}\n\n${tags.join(' ')}`
  // X counts every link as 23 characters.
  const xTags = tags.slice(0, 2).join(' ')
  const room = 280 - 23 - xTags.length - 4
  const x = `${clip(post.title, room)} ${link} ${xTags}`
  const whatsapp = `*${post.title}*\n\n${clip(post.excerpt, 300)}\n\n${link}`
  return { instagram, linkedin, x, whatsapp }
}
