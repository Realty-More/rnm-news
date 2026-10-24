import { Link } from 'react-router-dom'
import { SOCIALS, WHATSAPP_CHANNEL } from '../lib/config.ts'
import { useT } from '../lib/i18n.ts'
import { CURATED_CATEGORIES, SITE } from '../lib/wp.ts'
import { Icon } from './Icon.tsx'

export function SocialLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`socials ${compact ? 'compact' : ''}`}>
      {WHATSAPP_CHANNEL && (
        <a href={WHATSAPP_CHANNEL} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp Channel" className="social wa">
          <Icon name="whatsapp" size={18} />
        </a>
      )}
      {SOCIALS.map((s) => (
        <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.name} className="social">
          <Icon name={s.icon} size={18} />
        </a>
      ))}
    </div>
  )
}

export function SiteFooter() {
  const t = useT()
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <img className="logo logo-light" src="./brand/logo.png" alt="Realty & More" width={84} height={48} />
          <img className="logo logo-dark" src="./brand/logo_white.png" alt="" width={84} height={48} />
          <p>{t('footer.about')}</p>
          <SocialLinks />
        </div>
        <nav className="footer-col" aria-label="Sections">
          <h3>{t('footer.sections')}</h3>
          {CURATED_CATEGORIES.slice(1, 7).map((c) => (
            <Link key={c.slug} to={`/category/${c.slug}`}>
              {c.label}
            </Link>
          ))}
        </nav>
        <nav className="footer-col" aria-label="App">
          <h3>{t('footer.app')}</h3>
          <Link to="/news">{t('nav.news')}</Link>
          <Link to="/videos">{t('nav.videos')}</Link>
          <Link to="/podcasts">{t('nav.podcasts')}</Link>
          <Link to="/saved">{t('nav.saved')}</Link>
          <Link to="/settings">{t('settings.title')}</Link>
        </nav>
      </div>
      <p className="footer-legal">
        © {new Date().getFullYear()} Realty &amp; More. {t('footer.source')}{' '}
        <a href={SITE} target="_blank" rel="noopener noreferrer">
          realtynmore.com
        </a>
        .
      </p>
    </footer>
  )
}
