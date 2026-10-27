// A team member's picture: their photo, else their chosen avatar, else their initials.
const COLORS = ['#FAA61B', '#2E9D5B', '#3B7DDD', '#C2477A', '#7A5AF8', '#D9502E', '#0F9BA8', '#8A6D3B']

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

const colorFor = (name: string) => COLORS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length]

export function PersonAvatar({ name, photo, avatar, size = 40 }: { name: string; photo?: string | null; avatar?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * (avatar ? 0.55 : 0.4)) }
  if (photo) return <img className="person-avatar" src={photo} alt={name} width={size} height={size} style={style} />
  if (avatar)
    return (
      <span className="person-avatar emoji" style={style} role="img" aria-label={name}>
        {avatar}
      </span>
    )
  return (
    <span className="person-avatar initials" style={{ ...style, background: colorFor(name) }} role="img" aria-label={name}>
      {initials(name)}
    </span>
  )
}
