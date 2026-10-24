import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout.tsx'
import { Home } from './pages/Home.tsx'
import { News } from './pages/News.tsx'
import { Categories, CategoryPage } from './pages/Categories.tsx'
import { Search } from './pages/Search.tsx'
import { Article } from './pages/Article.tsx'
import { Videos } from './pages/Videos.tsx'
import { Podcasts } from './pages/Podcasts.tsx'
import { Saved } from './pages/Saved.tsx'
import { NotFound } from './pages/NotFound.tsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="news" element={<News />} />
        <Route path="categories" element={<Categories />} />
        <Route path="category/:slug" element={<CategoryPage />} />
        <Route path="search" element={<Search />} />
        <Route path="article/:id" element={<Article />} />
        <Route path="read/:slug" element={<Article />} />
        <Route path="videos" element={<Videos />} />
        <Route path="podcasts" element={<Podcasts />} />
        <Route path="saved" element={<Saved />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
