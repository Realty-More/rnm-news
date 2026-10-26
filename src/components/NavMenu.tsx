// App navigation pieces: the slide-in menu, the section rail under the header,
// and the header that tucks away while reading (Apple News / Google News style).
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { CURATED_CATEGORIES } from '../lib/wp.ts'
import { CITIES, setTheme, usePrefs, useTheme, type ThemePref } from '../lib/prefs.ts'
import { useT, type TKey } from '../lib/i18n.ts'
import { Icon, type IconName } from './Icon.tsx'
import { SocialLinks } from './SiteFooter.tsx'
import { toast } from './Toast.tsx'
import { forgetOwner, ownerKey, ownerRole } from '../lib/owner.ts'

const QUICK: { to: string; label: TKey; icon: IconName }[] = [
  { to: '/news', label: 'nav.news', icon: 'news' },
  { to: '/markets', label: 'nav.markets', icon: 'chart' },
  { to: '/videos', label: 'nav.videos', icon: 'play' },
  { to: '/shorts', label: 'videos.shorts', icon: 'flame' },
  { to: '/podcasts', label: 'nav.podcasts', icon: 'mic' },
  { to: '/saved', label: 'nav.saved', icon: 'bookmark' },
]

const THEMES: { key: ThemePref; label: TKey; icon: IconName }[] = [
  { key: 'system', label: 'theme.system', icon: 'sparkle' },
  { key: 'light', label: 'theme.light', icon: 'sun' },
  { key: 'dark', label: 'theme.dark', icon: 'moon' },
]

/** Full menu: every section, city and screen in one place, plus theme and language. */
export function NavMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const [prefs, update] = usePrefs()
  const [theme] = useTheme()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.documentElement.classList.add('menu-open')
    panel.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('menu-open')
    }
  }, [open, onClose])

  return (
    <div className={`nav-menu ${open ? 'open' : ''}`} aria-hidden={!open} inert={!open}>
      <button className="nav-scrim" onClick={onClose} aria-label={t('menu.close')} tabIndex={-1} />
      <div className="nav-panel" role="dialog" aria-modal="true" aria-label={t('nav.menu')} tabIndex={-1} ref={panel}>
        <div className="nav-panel-head">
          <img className="logo logo-light" src="./brand/logo.png" alt="Realty & More" width={84} height={48} />
          <img className="logo logo-dark" src="./brand/logo_white.png" alt="" width={84} height={48} />
          <button className="icon-btn" onClick={onClose} aria-label={t('menu.close')}>
            <Icon name="close" />
          </button>
        </div>

        <Link to="/search" className="nav-search" onClick={onClose}>
          <Icon name="search" size={18} />
          {t('menu.search')}
        </Link>

        <div className="nav-quick">
          {QUICK.map((q) => (
            <NavLink key={q.to} to={q.to} onClick={onClose}>
              <Icon name={q.icon} size={20} />
              <span>{t(q.label)}</span>
            </NavLink>
          ))}
        </div>

        <h2 className="nav-h">{t('menu.sections')}</h2>
        <ul className="nav-list">
          {CURATED_CATEGORIES.map((c) => (
            <li key={c.slug}>
              <NavLink to={`/category/${c.slug}`} onClick={onClose}>
                {c.label}
                <Icon name="chevron" size={16} />
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink to="/categories" onClick={onClose}>
              {t('menu.allSections')}
              <Icon name="grid" size={16} />
            </NavLink>
          </li>
        </ul>

        <h2 className="nav-h">{t('menu.cities')}</h2>
        <div className="nav-cities">
          {CITIES.map((c) => (
            <Link key={c} to={`/search?q=${encodeURIComponent(c)}`} onClick={onClose}>
              {c}
            </Link>
          ))}
        </div>

        <h2 className="nav-h">{t('menu.appearance')}</h2>
        <div className="segmented nav-seg" role="radiogroup" aria-label={t('menu.appearance')}>
          {THEMES.map((th) => (
            <button key={th.key} role="radio" aria-checked={theme === th.key} className={theme === th.key ? 'on' : ''} onClick={() => setTheme(th.key)}>
              <Icon name={th.icon} size={15} /> {t(th.label)}
            </button>
          ))}
        </div>
        <div className="segmented nav-seg" role="radiogroup" aria-label="Language">
          <button role="radio" aria-checked={prefs.lang === 'en'} className={prefs.lang === 'en' ? 'on' : ''} onClick={() => update({ lang: 'en' })}>
            English
          </button>
          <button role="radio" aria-checked={prefs.lang === 'hi'} className={prefs.lang === 'hi' ? 'on' : ''} onClick={() => update({ lang: 'hi' })}>
            हिंदी
          </button>
        </div>

        <ul className="nav-list">
          <li>
            <NavLink to="/settings" onClick={onClose}>
              <span className="nav-li-icon">
                <Icon name="settings" size={18} /> {t('menu.settings')}
              </span>
              <Icon name="chevron" size={16} />
            </NavLink>
          </li>
        </ul>

        <TeamLogin open={open} onClose={onClose} />

        <h2 className="nav-h">{t('home.followUs')}</h2>
        <SocialLinks />
        <p className="nav-foot">Realty &amp; More · realtynmore.com</p>
      </div>
    </div>
  )
}

/** Log in / log out for the owner and team (readers never need it). */
function TeamLogin({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // Read on every open, so it reflects a login or logout made elsewhere.
  const [who, setWho] = useState(() => (ownerKey() ? ownerRole() : null))
  useEffect(() => {
    if (open) setWho(ownerKey() ? ownerRole() : null)
  }, [open])
  const logout = () => {
    if (!window.confirm(t('menu.logoutAsk'))) return
    forgetOwner()
    setWho(null)
    toast(t('menu.loggedOut'))
    onClose()
    if (pathname.startsWith('/studio')) navigate('/')
  }
  return (
    <>
      <h2 className="nav-h">{who?.role === 'owner' ? t('menu.owner') : t('menu.team')}</h2>
      {who ? (
        <div className="nav-login">
          <Link to="/studio" onClick={onClose} className="nav-login-who">
            {who.role === 'owner' ? (
              <img className="nav-login-avatar photo" src="./brand/palash.jpg" alt="" width={36} height={36} />
            ) : (
              <span className="nav-login-avatar" aria-hidden="true">
                {who.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span>
              <strong>{who.name}</strong>
              <small>{who.role === 'owner' ? 'Founder & Editor · Content Studio' : who.role === 'admin' ? 'Full access · Content Studio' : `${t('menu.team')} · Content Studio`}</small>
            </span>
          </Link>
          <button className="btn ghost small" onClick={logout}>
            {t('menu.logout')}
          </button>
        </div>
      ) : (
        <ul className="nav-list">
          <li>
            <NavLink to="/studio" onClick={onClose}>
              <span className="nav-li-icon">
                <Icon name="settings" size={18} /> {t('menu.login')}
              </span>
              <Icon name="chevron" size={16} />
            </NavLink>
          </li>
        </ul>
      )}
    </>
  )
}

const RAIL = CURATED_CATEGORIES.filter((c) => c.slug !== 'news')

/** Horizontal sections under the header on browse screens; keeps the active one in view. */
export function SectionRail() {
  const t = useT()
  const { pathname } = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('.active')
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [pathname])
  return (
    <nav className="rail" aria-label={t('menu.sections')}>
      <div className="rail-track" ref={ref}>
        <NavLink to="/" end>
          {t('nav.top')}
        </NavLink>
        <NavLink to="/news">{t('home.latest')}</NavLink>
        <NavLink to="/markets">{t('nav.markets')}</NavLink>
        {RAIL.map((c) => (
          <NavLink key={c.slug} to={`/category/${c.slug}`}>
            {c.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

/** True while the reader scrolls down past the fold (hide chrome); false on any scroll up. */
export function useHideOnScroll(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (!enabled) {
      setHidden(false)
      return
    }
    let last = window.scrollY
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = window.scrollY
        const delta = y - last
        if (y < 140) setHidden(false)
        else if (delta > 8) setHidden(true)
        else if (delta < -8) setHidden(false)
        if (Math.abs(delta) > 8 || y < 140) last = y
        ticking = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [enabled])
  return hidden
}

/** Videos · Shorts · Podcasts switcher at the top of the Watch screens. */
export function WatchTabs() {
  const t = useT()
  return (
    <nav className="segmented wide watch-tabs" aria-label={t('nav.watch')}>
      <NavLink to="/videos">{t('nav.videos')}</NavLink>
      <NavLink to="/shorts">{t('videos.shorts')}</NavLink>
      <NavLink to="/podcasts">{t('nav.podcasts')}</NavLink>
    </nav>
  )
}
