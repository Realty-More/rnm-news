// Home: the latest R&M Magazine issue, opening the in-app reader.
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n.ts'
import { useAsync } from '../lib/hooks.ts'
import { loadMagazine } from '../lib/magazine.ts'
import { Icon } from './Icon.tsx'

export function MagazineBand() {
  const t = useT()
  const res = useAsync(
    'magazine:latest:v2',
    async (signal) => (await loadMagazine(signal)).slice(0, 4),
    { persist: true },
  )
  const [latest, ...more] = res.data ?? []
  if (!latest) return null
  return (
    <section className="band mz-band" aria-labelledby="mz-h">
      <div className="section-head">
        <h2 id="mz-h">{t('home.magazine')}</h2>
        <Link to="/magazine" className="see-all">
          {t('home.allIssues')} <Icon name="chevron" size={16} />
        </Link>
      </div>
      <div className="mz-band-row">
        <Link to={`/magazine/${latest.id}`} className="mz-band-main">
          <img src={latest.cover} alt={`R&M Magazine ${latest.title} cover`} loading="lazy" width={560} height={792} />
          <span className="mz-band-text">
            <span className="kicker">{t('home.magazineSub')}</span>
            <strong>{latest.title}</strong>
            <span className="mz-band-meta">{latest.pages} pages</span>
            <span className="btn btn-sm">
              <Icon name="magazine" size={16} /> {t('home.readIssue')}
            </span>
          </span>
        </Link>
        <div className="mz-band-more">
          {more.map((i) => (
            <Link key={i.id} to={`/magazine/${i.id}`} aria-label={`R&M Magazine ${i.title}`}>
              <img src={i.cover} alt="" loading="lazy" width={560} height={792} />
              <span>{i.title}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
