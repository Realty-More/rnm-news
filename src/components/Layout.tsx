import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Capacitor } from '@capacitor/core'
import { useOnline } from '../lib/hooks.ts'
import { refreshOffline } from '../lib/offline.ts'
import { usePrefs } from '../lib/prefs.ts'
import { syncPushFilters } from '../lib/push.ts'
import { trackScreen } from '../lib/stats.ts'
import { Icon, type IconName } from './Icon.tsx'
import { Toaster } from './Toast.tsx'
import { Ticker } from './Ticker.tsx'
import { AnnouncementBanner } from './SiteExtras.tsx'
import { SiteFooter } from './SiteFooter.tsx'
import { useT, type TKey } from '../lib/i18n.ts'
import { NavMenu, SectionRail, useHideOnScroll } from './NavMenu.tsx'
import { Assistant, assistantReady, openAssistant } from './Assistant.tsx'

// Desktop header links.
const TABS: { to: string; label: TKey }[] = [
  { to: '/', label: 'nav.home' },
  { to: '/news', label: 'nav.news' },
  { to: '/categories', label: 'nav.categories' },
  { to: '/markets', label: 'nav.markets' },
  { to: '/videos', label: 'nav.videos' },
  { to: '/podcasts', label: 'nav.podcasts' },
  { to: '/saved', label: 'nav.saved' },
]

// Phone tab bar: five destinations, like Apple News and Bloomberg. "Watch" covers videos, Shorts and podcasts.
const MOBILE_TABS: { to: string; label: TKey; icon: IconName; match: (p: string) => boolean }[] = [
  { to: '/', label: 'nav.home', icon: 'home', match: (p) => p === '/' },
  { to: '/news', label: 'nav.news', icon: 'news', match: (p) => p === '/news' || p.startsWith('/category') || p === '/categories' },
  { to: '/markets', label: 'nav.markets', icon: 'chart', match: (p) => p === '/markets' },
  { to: '/videos', label: 'nav.watch', icon: 'play', match: (p) => p === '/videos' || p === '/shorts' || p === '/podcasts' },
  { to: '/saved', label: 'nav.saved', icon: 'bookmark', match: (p) => p === '/saved' },
]

/** Screens that get the section rail under the header. */
const browsing = (p: string) => p === '/' || p === '/news' || p === '/markets' || p.startsWith('/category/')

interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function useInstall() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as InstallEvent)
    }
    const onInstalled = () => setDeferred(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone
  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
  }
  return { canInstall: !!deferred && !standalone, isIos: isIos && !Capacitor.isNativePlatform(), install }
}

function InstallBanner() {
  const { canInstall, isIos, install } = useInstall()
  const t = useT()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('rnm-install-dismissed') === '1'
    } catch {
      return false
    }
  })
  if (dismissed || (!canInstall && !isIos)) return null
  const close = () => {
    setDismissed(true)
    try {
      localStorage.setItem('rnm-install-dismissed', '1')
    } catch {
      /* ignore */
    }
  }
  return (
    <div className="install-banner">
      <img src="./icons/icon-192.png" alt="" width={40} height={40} />
      <div className="install-text">
        <strong>{t('install.title')}</strong>
        <span>{canInstall ? t('install.text') : 'Tap Share, then “Add to Home Screen”.'}</span>
      </div>
      {canInstall && (
        <button className="btn small" onClick={install}>
          {t('install.button')}
        </button>
      )}
      <button className="icon-btn" onClick={close} aria-label="Dismiss">
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })
  const t = useT()
  useEffect(() => {
    if (!offlineReady) return
    const t = setTimeout(() => setOfflineReady(false), 3500)
    return () => clearTimeout(t)
  }, [offlineReady, setOfflineReady])

  if (needRefresh) {
    return (
      <div className="update-bar" role="status">
        <span>{t('update.ready')}</span>
        <button className="btn small" onClick={() => updateServiceWorker(true)}>
          {t('update.reload')}
        </button>
        <button className="icon-btn" onClick={() => setNeedRefresh(false)} aria-label="Later">
          <Icon name="close" size={18} />
        </button>
      </div>
    )
  }
  if (offlineReady) return <div className="update-bar" role="status">App ready to work offline.</div>
  return null
}

export function Layout() {
  const online = useOnline()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isArticle = pathname.startsWith('/article') || pathname.startsWith('/read')
  // Reading a magazine issue is full screen: the reader has its own toolbar.
  const immersive = /^\/magazine\/\d/.test(pathname)
  const [prefs] = usePrefs()
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const chromeHidden = useHideOnScroll(!menuOpen && !pathname.startsWith('/studio'))

  useEffect(() => {
    trackScreen(pathname)
    setMenuOpen(false)
  }, [pathname])

  // Tapping the tab you're already on goes back to the top, as in native apps.
  const onTab = (active: boolean) => {
    if (active) window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Keep topic-filtered alerts in step with My Feed.
  const feedKey = JSON.stringify([prefs.notifyMode, prefs.topics, prefs.cities])
  useEffect(() => {
    const t = setTimeout(() => void syncPushFilters().catch(() => {}), 1500)
    return () => clearTimeout(t)
  }, [feedKey])

  useEffect(() => {
    if (!isArticle) window.scrollTo(0, 0)
  }, [pathname, isArticle])

  // Keep the latest stories downloaded for offline reading (throttled inside).
  useEffect(() => {
    const run = () => void refreshOffline().catch(() => {})
    const t = setTimeout(run, 4000)
    window.addEventListener('online', run)
    return () => {
      clearTimeout(t)
      window.removeEventListener('online', run)
    }
  }, [])

  return (
    <div className={`app ${immersive ? 'immersive' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`topbar ${chromeHidden ? 'tucked' : ''}`}>
        <div className="topbar-inner">
          {isArticle ? (
            <button className="icon-btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} aria-label="Back">
              <Icon name="back" />
            </button>
          ) : null}
          <NavLink to="/" className="brand" aria-label="Realty & More home">
            <img className="logo logo-light" src="./brand/logo.png" alt="Realty & More" width={84} height={48} />
            <img className="logo logo-dark" src="./brand/logo_white.png" alt="" width={84} height={48} />
          </NavLink>
          <nav className="desk-nav" aria-label="Sections">
            {TABS.map((tab) => (
              <NavLink key={tab.to} to={tab.to} end={tab.to === '/'}>
                {t(tab.label)}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-actions">
            {assistantReady && (
              <button className="icon-btn ask-btn" onClick={() => openAssistant()} aria-label="Ask R&M (AI)">
                <Icon name="sparkle" />
              </button>
            )}
            <NavLink to="/search" className="icon-btn" aria-label="Search">
              <Icon name="search" />
            </NavLink>
            <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label={t('nav.menu')} aria-expanded={menuOpen}>
              <Icon name="menu" />
            </button>
          </div>
        </div>
        {browsing(pathname) && <SectionRail />}
      </header>
      <NavMenu open={menuOpen} onClose={closeMenu} />
      <Assistant />

      {!isArticle && !immersive && !pathname.startsWith('/studio') && <Ticker />}
      {!immersive && !pathname.startsWith('/studio') && <AnnouncementBanner />}

      {!online && (
        <div className="offline-bar" role="status">
          <Icon name="offline" size={16} /> {t('offline.bar')}
        </div>
      )}

      <main id="main" className="main">
        <InstallBanner />
        <Outlet />
      </main>

      {!immersive && <SiteFooter />}

      <nav className={`tabbar ${isArticle ? 'reading' : ''}`} aria-label="Main">
        {MOBILE_TABS.map((tab) => {
          const active = tab.match(pathname)
          return (
            <Link key={tab.to} to={tab.to} className={`tab ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => onTab(active)}>
              <span className="tab-icon">
                <Icon name={tab.icon} />
              </span>
              <span>{t(tab.label)}</span>
            </Link>
          )
        })}
      </nav>
      <UpdatePrompt />
      <Toaster />
    </div>
  )
}
