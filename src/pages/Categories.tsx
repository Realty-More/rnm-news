import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/States.tsx'
import { Icon } from '../components/Icon.tsx'
import { useAsync } from '../lib/hooks.ts'
import { categoryBySlug, CURATED_CATEGORIES, fetchCategories } from '../lib/wp.ts'
import { PostFeed } from './News.tsx'
import { usePageTitle } from './usePageTitle.ts'

export function Categories() {
  usePageTitle('Categories')
  const res = useAsync('categories', (s) => fetchCategories(s))
  const counts = new Map(res.data?.map((c) => [c.id, c]))

  return (
    <div className="page">
      <div className="page-head">
        <h1>Categories</h1>
        <p className="page-sub">Sections from realtynmore.com</p>
      </div>
      <div className="cat-grid">
        {CURATED_CATEGORIES.map((c, i) => {
          const live = counts.get(c.id)
          return (
            <Link key={c.slug} to={`/category/${c.slug}`} className={`cat-tile ${i === 0 ? 'feature' : ''}`}>
              <span className="cat-name">{c.label}</span>
              <span className="cat-count">{live ? `${live.count.toLocaleString('en-IN')} stories` : res.loading ? ' ' : ''}</span>
              <Icon name="chevron" size={18} className="cat-arrow" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export function CategoryPage() {
  const { slug = '' } = useParams()
  const cat = categoryBySlug(slug)
  usePageTitle(cat?.label ?? 'Category')
  if (!cat) {
    return (
      <div className="page">
        <EmptyState title="Category not found">
          <Link to="/categories">See all categories</Link>
        </EmptyState>
      </div>
    )
  }
  return (
    <div className="page">
      <div className="page-head">
        <Link to="/categories" className="crumb">
          Categories
        </Link>
        <h1>{cat.label}</h1>
      </div>
      <PostFeed category={cat.id} />
    </div>
  )
}
