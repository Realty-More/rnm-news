// Team today → Office location → "Choose on map": search an address or move the map until the pin
// sits on the office, then add it. OpenStreetMap tiles and search (Nominatim), both free; loaded only
// when the picker opens.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { simplerAddresses, spotFromText } from '../lib/places.ts'

interface Hit {
  name: string
  full: string
  lat: number
  lng: number
}

const NOIDA: [number, number] = [28.5355, 77.391]

async function nominatim(q: string): Promise<Hit[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in&accept-language=en&viewbox=76.8,28.95,77.75,28.3&bounded=0&q=${encodeURIComponent(q)}`
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(String(r.status))
  const rows = (await r.json()) as { lat: string; lon: string; name?: string; display_name: string }[]
  return rows.map((x) => ({ name: x.name || x.display_name.split(',')[0], full: x.display_name, lat: Number(x.lat), lng: Number(x.lon) }))
}

/** Backup search: Photon, biased towards Noida and limited to India. */
async function photon(q: string): Promise<Hit[]> {
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=en&lat=${NOIDA[0]}&lon=${NOIDA[1]}`)
  if (!r.ok) throw new Error(String(r.status))
  const d = (await r.json()) as { features: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }[] }
  return d.features
    .filter((f) => f.properties.countrycode === 'IN')
    .slice(0, 6)
    .map((f) => {
      const p = f.properties
      const full = [p.name, p.street, p.district, p.city, p.state, p.postcode].filter(Boolean).join(', ')
      return { name: p.name || p.street || full.split(',')[0], full, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }
    })
}

/** When the search names a sector ("Sector 3"), keep only results in that sector, not "Sector 31". */
function sameSector(q: string, hits: Hit[]): Hit[] {
  const m = q.match(/\bsec(?:tor)?[-\s.]*(\d{1,3}[a-z]?)\b/i)
  if (!m) return hits
  const re = new RegExp(String.raw`\bsec(?:tor)?[-\s.]*${m[1]}\b`, 'i')
  return hits.filter((h) => re.test(`${h.name}, ${h.full}`))
}

/**
 * Address search on OpenStreetMap (both services free). Tries the address as typed, then shorter
 * versions of it; each with Nominatim first and Photon as the backup. `rough` is true when only a
 * shorter version matched, so the result is the area, not the building.
 */
async function searchPlaces(q: string): Promise<{ hits: Hit[]; rough: boolean }> {
  let failed = 0
  let tried = 0
  const tries = simplerAddresses(q)
  for (const [i, t] of tries.entries()) {
    for (const find of [nominatim, photon]) {
      tried++
      try {
        const hits = sameSector(t, await find(t))
        if (hits.length) return { hits, rough: i > 0 }
      } catch {
        failed++
      }
    }
  }
  if (failed === tried) throw new Error('Search is busy. Try again in a moment, or move the map yourself.')
  return { hits: [], rough: false }
}

export default function OfficePicker({ start, radius, onPick }: { start?: { lat: number; lng: number } | null; radius: number; onPick: (p: { lat: number; lng: number; name: string }) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const ring = useRef<L.Circle | null>(null)
  const [center, setCenter] = useState<{ lat: number; lng: number }>(start ?? { lat: NOIDA[0], lng: NOIDA[1] })
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    if (!box.current || map.current) return
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView(start ? [start.lat, start.lng] : NOIDA, start ? 17 : 12)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m)
    ring.current = L.circle(m.getCenter(), { radius, color: '#F2711C', weight: 1.5, fillColor: '#FBA519', fillOpacity: 0.15, interactive: false }).addTo(m)
    const sync = () => {
      const c = m.getCenter()
      ring.current?.setLatLng(c)
      setCenter({ lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 })
    }
    m.on('move', sync)
    // Tapping the map moves the pin there.
    m.on('click', (e: L.LeafletMouseEvent) => m.panTo(e.latlng))
    map.current = m
    setTimeout(() => m.invalidateSize(), 80)
    return () => {
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    ring.current?.setRadius(radius)
  }, [radius])

  const search = async (e: FormEvent) => {
    e.preventDefault()
    if (q.trim().length < 3) return setErr('Type at least 3 letters of the address.')
    setErr('')
    setNote('')
    // A pasted Google Maps link or "lat, lng": go straight there.
    const spot = spotFromText(q)
    if (spot) {
      map.current?.setView([spot.lat, spot.lng], 18)
      setHits(null)
      return setNote('Pin moved to that spot. Check it sits on the office building, then add it.')
    }
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(q))
      return setErr('Short Google Maps links can’t be opened here. In Google Maps, press and hold the office pin, copy the numbers shown (like 28.583181, 77.318678) and paste them here.')
    setBusy(true)
    try {
      const r = await searchPlaces(q.trim())
      setHits(r.hits)
      if (!r.hits.length) setErr('Nothing found. Try a shorter address, like “Sector 3 Noida”, or paste the office’s Google Maps link or numbers.')
      else if (r.rough) setNote('The exact building isn’t on this map, so this shows the area. Pick a result, then move the map until the pin sits on the office.')
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Search failed.')
    } finally {
      setBusy(false)
    }
  }
  const go = (h: Hit) => {
    map.current?.setView([h.lat, h.lng], 17)
    setHits(null)
    // Use the place's name only when it is a real name (not just a house number).
    if (!name && h.name.length >= 4 && !/^[\d\s/-]+$/.test(h.name)) setName(h.name.slice(0, 40))
  }

  return (
    <div className="op">
      <form className="op-search" onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Address, Google Maps link, or 28.58, 77.31" aria-label="Search address, or paste a Google Maps link" enterKeyHint="search" />
        <button className="btn small" disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      {err && <p className="op-err">{err}</p>}
      {note && !err && <p className="op-note">{note}</p>}
      {hits && hits.length > 0 && (
        <ul className="op-hits">
          {hits.map((h, i) => (
            <li key={i}>
              <button type="button" onClick={() => go(h)}>
                <b>{h.name}</b>
                <small>{h.full}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="op-mapwrap">
        <div ref={box} className="op-map" role="region" aria-label="Map: move it until the pin is on the office" />
        <div className="op-pin" aria-hidden="true">
          <span>
            <em>🏢</em>
          </span>
          <i />
        </div>
      </div>
      <p className="op-help">Move or zoom the map until the pin sits on the office building. You can also tap the map. The orange circle is the “At office” area.</p>
      <div className="op-foot">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Office name, e.g. Noida Office" maxLength={40} aria-label="Office name" />
        <button className="btn" onClick={() => onPick({ ...center, name: name.trim() || 'Office' })}>
          Add as office
        </button>
      </div>
      <a className="op-check" href={`https://www.google.com/maps?q=${center.lat},${center.lng}`} target="_blank" rel="noopener noreferrer">
        Check this spot in Google Maps ↗
      </a>
    </div>
  )
}
