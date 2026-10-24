import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout.tsx'
import { SkeletonList } from './components/States.tsx'
import { Home } from './pages/Home.tsx'
import { News } from './pages/News.tsx'
import { NotFound } from './pages/NotFound.tsx'

// Screens other than Home load on demand, so the first screen opens faster.
const Categories = lazy(() => import('./pages/Categories.tsx').then((m) => ({ default: m.Categories })))
const CategoryPage = lazy(() => import('./pages/Categories.tsx').then((m) => ({ default: m.CategoryPage })))
const Search = lazy(() => import('./pages/Search.tsx').then((m) => ({ default: m.Search })))
const Article = lazy(() => import('./pages/Article.tsx').then((m) => ({ default: m.Article })))
const Videos = lazy(() => import('./pages/Videos.tsx').then((m) => ({ default: m.Videos })))
const Podcasts = lazy(() => import('./pages/Podcasts.tsx').then((m) => ({ default: m.Podcasts })))
const Saved = lazy(() => import('./pages/Saved.tsx').then((m) => ({ default: m.Saved })))
const Shorts = lazy(() => import('./pages/Shorts.tsx').then((m) => ({ default: m.Shorts })))
const Studio = lazy(() => import('./pages/Studio.tsx').then((m) => ({ default: m.Studio })))
const Markets = lazy(() => import('./pages/Markets.tsx').then((m) => ({ default: m.Markets })))
const Settings = lazy(() => import('./pages/Settings.tsx').then((m) => ({ default: m.Settings })))

const fallback = (
  <div className="page">
    <SkeletonList count={4} />
  </div>
)

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="news" element={<News />} />
        <Route path="categories" element={<Suspense fallback={fallback}><Categories /></Suspense>} />
        <Route path="category/:slug" element={<Suspense fallback={fallback}><CategoryPage /></Suspense>} />
        <Route path="search" element={<Suspense fallback={fallback}><Search /></Suspense>} />
        <Route path="article/:id" element={<Suspense fallback={fallback}><Article /></Suspense>} />
        <Route path="read/:slug" element={<Suspense fallback={fallback}><Article /></Suspense>} />
        <Route path="videos" element={<Suspense fallback={fallback}><Videos /></Suspense>} />
        <Route path="shorts" element={<Suspense fallback={fallback}><Shorts /></Suspense>} />
        <Route path="podcasts" element={<Suspense fallback={fallback}><Podcasts /></Suspense>} />
        <Route path="saved" element={<Suspense fallback={fallback}><Saved /></Suspense>} />
        <Route path="studio" element={<Suspense fallback={fallback}><Studio /></Suspense>} />
        <Route path="markets" element={<Suspense fallback={fallback}><Markets /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={fallback}><Settings /></Suspense>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
