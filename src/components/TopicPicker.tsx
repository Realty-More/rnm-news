import { CITIES } from '../lib/prefs.ts'
import { CURATED_CATEGORIES } from '../lib/wp.ts'

export function TopicPicker({ topics, cities, onChange }: { topics: string[]; cities: string[]; onChange: (topics: string[], cities: string[]) => void }) {
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  return (
    <div className="topic-picker">
      <p className="picker-label">Sections</p>
      <div className="chips wrap">
        {CURATED_CATEGORIES.filter((c) => c.slug !== 'news').map((c) => (
          <button key={c.slug} className={`chip ${topics.includes(c.slug) ? 'active' : ''}`} aria-pressed={topics.includes(c.slug)} onClick={() => onChange(toggle(topics, c.slug), cities)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="picker-label">Cities</p>
      <div className="chips wrap">
        {CITIES.map((c) => (
          <button key={c} className={`chip ${cities.includes(c) ? 'active' : ''}`} aria-pressed={cities.includes(c)} onClick={() => onChange(topics, toggle(cities, c))}>
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}
