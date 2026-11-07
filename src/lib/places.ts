// Helpers for the office map picker: positions pasted as text or Google Maps links, and shorter
// versions of long addresses for the OpenStreetMap search.

const okSpot = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

/**
 * A position typed or pasted in the search box: "28.583181, 77.318678", or a full Google Maps link
 * (the place pin "!3d…!4d…", the map centre "@lat,lng", or "?q=lat,lng"). Null if it isn't one.
 */
export function spotFromText(text: string): { lat: number; lng: number } | null {
  let s = text.trim()
  try {
    s = decodeURIComponent(s)
  } catch {
    /* keep the text as it is */
  }
  const num = String.raw`(-?\d{1,3}(?:\.\d+)?)`
  const pats = [
    new RegExp(String.raw`!3d${num}!4d${num}`),
    new RegExp(String.raw`[?&](?:q|query|ll|center|destination|daddr)=${num},\s*\+?${num}`),
    new RegExp(String.raw`@${num},\s*${num}`),
    new RegExp(String.raw`^${num}°?\s*[N]?\s*[,\s]\s*${num}°?\s*[E]?$`, 'i'),
  ]
  for (const re of pats) {
    const m = s.match(re)
    if (m && okSpot(Number(m[1]), Number(m[2]))) return { lat: Number(m[1]), lng: Number(m[2]) }
  }
  return null
}

const STATES = /\b(pradesh|haryana|delhi ncr|india|rajasthan|maharashtra|karnataka|state)\b/i

/**
 * Shorter versions of a long address (Google Maps style) to search when the full one finds nothing:
 * "Sector N <city>" for each sector named (the place's own sector before a "near …" one), then the
 * address without floor, plot no., "near …" and PIN code. The address as typed comes first.
 */
export function simplerAddresses(q: string): string[] {
  const parts = q
    .split(',')
    .map((p) => p.replace(/\b\d{6}\b/g, '').trim())
    .filter(Boolean)
  const keep = parts.filter((p) => !/\b(floor|flr|near|opp|opposite|behind|metro station|shop|unit|plot|office no|flat|tower|wing|gate)\b/i.test(p) && !/^[a-z]{0,3}[-\s/]?\d+[a-z]?$/i.test(p))
  // The city: the last plain-word part that isn't a state, e.g. "Noida".
  const city =
    [...keep]
      .reverse()
      .map((p) => p.replace(/\bsec(?:tor)?[-\s.]*\d{1,3}[a-z]?\b/gi, '').trim())
      .find((p) => p.length > 2 && !/\d/.test(p) && !STATES.test(p)) ?? ''
  const sectors: string[] = []
  for (const p of [...parts].sort((a, b) => Number(/\bnear\b/i.test(a)) - Number(/\bnear\b/i.test(b))))
    for (const m of p.matchAll(/\bsec(?:tor)?[-\s.]*(\d{1,3}[a-z]?)\b/gi)) sectors.push(`Sector ${m[1].toUpperCase()}${city ? ` ${city}` : ''}`)
  const out = [q.trim(), ...sectors, keep.join(', '), keep.slice(-3).join(', ')]
  return [...new Set(out.map((x) => x.trim()).filter((x) => x.length >= 3))].slice(0, 4)
}
