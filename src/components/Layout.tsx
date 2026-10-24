import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Capacitor } from '@capacitor/core'
import { useOnline } from '../lib/hooks.ts'
import { refreshOffline } from '../lib/offline.ts'
import { effectiveTheme, setTheme, usePrefs, useTheme } from '../lib/prefs.ts'
import { syncPushFilters } from '../lib/push.ts'
import { trackScreen } from '../lib/stats.ts'
import { Icon, type IconName } from './Icon.tsx'
import { Toaster } from './Toast.tsx'
import { Ticker } from './Ticker.tsx'
import { SiteFooter } from './SiteFooter.tsx'
import { useT, type TKey } from '../lib/i18n.ts'

const TABS: { to: string; label: TKey; icon: IconName; mobile: boolean }[] = [
  { to: '/', label: 'nav.home', icon: 'home', mobile: true },
  { to: '/news', label: 'nav.news', icon: 'news', mobile: true },
  { to: '/categories', label: 'nav.categories', icon: 'grid', mobile: false },
  { to: '/videos', label: 'nav.videos', icon: 'play', mobile: true },
  { to: '/podcasts', label: 'nav.podcasts', icon: 'mic', mobile: true },
  { to: '/markets', label: 'nav.markets', icon: 'chart', mobile: false },
  { to: '/saved', label: 'nav.saved', icon: 'bookmark', mobile: true },
]

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
  const [themePref] = useTheme()
  const theme = effectiveTheme(themePref)
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')
  const online = useOnline()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isArticle = pathname.startsWith('/article') || pathname.startsWith('/read')
  const [prefs] = usePrefs()
  const t = useT()

  useEffect(() => {
    trackScreen(pathname)
  }, [pathname])

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
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
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
            <NavLink to="/search" className="icon-btn" aria-label="Search">
              <Icon name="search" />
            </NavLink>
            <NavLink to="/markets" className="icon-btn mobile-only" aria-label="Markets">
              <Icon name="chart" />
            </NavLink>
            <NavLink to="/categories" className="icon-btn mobile-only" aria-label="Categories">
              <Icon name="grid" />
            </NavLink>
            <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            <NavLink to="/settings" className="icon-btn" aria-label="Settings">
              <Icon name="settings" />
            </NavLink>
          </div>
        </div>
      </header>

      {!isArticle && !pathname.startsWith('/studio') && <Ticker />}

      {!online && (
        <div className="offline-bar" role="status">
          <Icon name="offline" size={16} /> {t('offline.bar')}
        </div>
      )}

      <main id="main" className="main">
        <InstallBanner />
        <Outlet />
      </main>

      <SiteFooter />

      <nav className={`tabbar ${isArticle ? 'reading' : ''}`} aria-label="Main">
        {TABS.filter((tab) => tab.mobile).map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className="tab">
            <Icon name={tab.icon} />
            <span>{t(tab.label)}</span>
          </NavLink>
        ))}
      </nav>
      <UpdatePrompt />
      <Toaster />
    </div>
  )
}
