import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Capacitor } from '@capacitor/core'
import { useOnline } from '../lib/hooks.ts'
import { Icon, type IconName } from './Icon.tsx'
import { Toaster } from './Toast.tsx'

const TABS: { to: string; label: string; icon: IconName; mobile: boolean }[] = [
  { to: '/', label: 'Home', icon: 'home', mobile: true },
  { to: '/news', label: 'News', icon: 'news', mobile: true },
  { to: '/categories', label: 'Categories', icon: 'grid', mobile: false },
  { to: '/videos', label: 'Videos', icon: 'play', mobile: true },
  { to: '/podcasts', label: 'Podcasts', icon: 'mic', mobile: true },
  { to: '/saved', label: 'Saved', icon: 'bookmark', mobile: true },
]

type Theme = 'light' | 'dark'

function useTheme(): [Theme, () => void] {
  const system = (): Theme => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme | undefined) ?? system())
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('rnm-theme', next)
    } catch {
      /* private mode */
    }
    setTheme(next)
  }
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', theme === 'dark' ? '#0E0E10' : '#141416')
  }, [theme])
  return [theme, toggle]
}

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
        <strong>Get the R&amp;M News app</strong>
        <span>{canInstall ? 'Fast, full screen, and works offline.' : 'Tap Share, then “Add to Home Screen”.'}</span>
      </div>
      {canInstall && (
        <button className="btn small" onClick={install}>
          Install
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
  useEffect(() => {
    if (!offlineReady) return
    const t = setTimeout(() => setOfflineReady(false), 3500)
    return () => clearTimeout(t)
  }, [offlineReady, setOfflineReady])

  if (needRefresh) {
    return (
      <div className="update-bar" role="status">
        <span>A new version is ready.</span>
        <button className="btn small" onClick={() => updateServiceWorker(true)}>
          Reload
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
  const [theme, toggleTheme] = useTheme()
  const online = useOnline()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isArticle = pathname.startsWith('/article') || pathname.startsWith('/read')

  useEffect(() => {
    if (!isArticle) window.scrollTo(0, 0)
  }, [pathname, isArticle])

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
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.to === '/'}>
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-actions">
            <NavLink to="/search" className="icon-btn" aria-label="Search">
              <Icon name="search" />
            </NavLink>
            <NavLink to="/categories" className="icon-btn mobile-only" aria-label="Categories">
              <Icon name="grid" />
            </NavLink>
            <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
          </div>
        </div>
      </header>

      {!online && (
        <div className="offline-bar" role="status">
          <Icon name="offline" size={16} /> Offline. Showing saved and recently read stories.
        </div>
      )}

      <main id="main" className="main">
        <InstallBanner />
        <Outlet />
      </main>

      <footer className="site-footer">
        <p>
          News, images and videos are published by{' '}
          <a href="https://realtynmore.com" target="_blank" rel="noopener noreferrer">
            RealtyNMore
          </a>
          . Videos via YouTube.
        </p>
      </footer>

      <nav className="tabbar" aria-label="Main">
        {TABS.filter((t) => t.mobile).map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className="tab">
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
      <UpdatePrompt />
      <Toaster />
    </div>
  )
}
