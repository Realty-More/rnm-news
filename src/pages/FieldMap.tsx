// Team today → Map (owner and full access): where each person checked in and out today, with the
// offices and their radius. OpenStreetMap tiles through Leaflet (free); loaded only when opened.
// Locations are saved only at check-in and check-out (never in between) and only managers see them.
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface Place {
  lat: number
  lng: number
  acc: number
  office: string | null
  meters: number | null
  label: string
}
export interface MapPerson {
  id: string
  name: string
  photo?: string
  checkIn?: string | null
  checkOut?: string | null
  late?: boolean
  mode?: string | null
  inPlace?: Place | null
  outPlace?: Place | null
}
export interface MapOffice {
  name: string
  lat: number
  lng: number
  radius: number
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }) : '–')
const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
const MODE: Record<string, string> = { office: 'Office', remote: 'Work from home', field: 'Field / site visit' }
const where = (p: Place) => (p.office ? `At ${p.office}` : p.meters != null ? `${p.meters < 1000 ? `${Math.round(p.meters)} m` : `${(p.meters / 1000).toFixed(1)} km`} from office` : 'Location shared')

function personIcon(p: MapPerson, kind: 'in' | 'out') {
  const tone = kind === 'out' ? 'out' : p.late ? 'late' : 'ok'
  const face = p.photo ? `<img src="${esc(p.photo)}" alt="">` : `<b>${esc(initials(p.name))}</b>`
  const html = kind === 'in' ? `<div class="fm-pin ${tone}"><span class="fm-face">${face}</span><i></i></div>` : `<div class="fm-pin out"><span class="fm-out">OUT</span><i></i></div>`
  return L.divIcon({ html, className: 'fm-icon', iconSize: kind === 'in' ? [42, 52] : [34, 42], iconAnchor: kind === 'in' ? [21, 50] : [17, 40], popupAnchor: [0, -44] })
}

export default function FieldMap({ people, offices }: { people: MapPerson[]; offices: MapOffice[] }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  useEffect(() => {
    if (!box.current || map.current) return
    const m = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m)
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])
  useEffect(() => {
    const m = map.current
    if (!m) return
    const layer = L.layerGroup().addTo(m)
    const points: L.LatLngExpression[] = []
    for (const o of offices) {
      L.circle([o.lat, o.lng], { radius: o.radius, color: '#F2711C', weight: 1.5, fillColor: '#FBA519', fillOpacity: 0.12 }).addTo(layer)
      L.marker([o.lat, o.lng], { icon: L.divIcon({ html: `<div class="fm-office">🏢 ${esc(o.name)}</div>`, className: 'fm-icon', iconSize: [0, 0] }), interactive: false }).addTo(layer)
      points.push([o.lat, o.lng])
    }
    for (const p of people) {
      const pin = (pl: Place, kind: 'in' | 'out') => {
        const gmaps = `https://www.google.com/maps?q=${pl.lat},${pl.lng}`
        const popup = `<div class="fm-pop"><b>${esc(p.name)}</b><span>${kind === 'in' ? `In ${time(p.checkIn)}${p.late ? ' · <em class="late">Late</em>' : ' · <em>On time</em>'}` : `Out ${time(p.checkOut)}`}</span><span>${esc(where(pl))}${pl.acc && pl.acc < 9999 ? (pl.acc >= 1000 ? ` · ±${Math.round(pl.acc / 1000)} km` : ` · ±${Math.round(pl.acc)} m`) : ''}</span>${kind === 'in' && p.mode ? `<span>${esc(MODE[p.mode] ?? p.mode)}</span>` : ''}<a href="${gmaps}" target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a></div>`
        L.marker([pl.lat, pl.lng], { icon: personIcon(p, kind), zIndexOffset: kind === 'in' ? 500 : 0 }).bindPopup(popup).addTo(layer)
        points.push([pl.lat, pl.lng])
      }
      if (p.outPlace) pin(p.outPlace, 'out')
      if (p.inPlace) pin(p.inPlace, 'in')
      if (p.inPlace && p.outPlace && L.latLng(p.inPlace.lat, p.inPlace.lng).distanceTo([p.outPlace.lat, p.outPlace.lng]) > 100)
        L.polyline(
          [
            [p.inPlace.lat, p.inPlace.lng],
            [p.outPlace.lat, p.outPlace.lng],
          ],
          { color: '#3B7DDD', weight: 2, dashArray: '6 6', opacity: 0.8 },
        ).addTo(layer)
    }
    if (points.length > 1) m.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 })
    else if (points.length === 1) m.setView(points[0], 15)
    else m.setView([28.5355, 77.391], 11)
    setTimeout(() => m.invalidateSize(), 50)
    return () => {
      layer.remove()
    }
  }, [people, offices])
  return <div ref={box} className="fm-map" role="region" aria-label="Map of today’s check-ins" />
}
