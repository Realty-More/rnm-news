// The phone's position, read once at check-in or check-out (never in the background).
export interface Spot {
  lat: number
  lng: number
  acc: number
}

/** Current position, or null if location is off, refused or too slow. */
export function getSpot(timeoutMs = 12000): Promise<Spot | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = setTimeout(() => resolve(null), timeoutMs + 1000)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(done)
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy })
      },
      () => {
        clearTimeout(done)
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    )
  })
}

export const mapLink = (p: { lat: number; lng: number }) => `https://www.google.com/maps?q=${p.lat},${p.lng}`
