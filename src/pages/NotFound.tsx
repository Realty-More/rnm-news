import { Link } from 'react-router-dom'
import { EmptyState } from '../components/States.tsx'

export function NotFound() {
  return (
    <div className="page">
      <EmptyState title="Page not found">
        <Link to="/">Go to Home</Link>
      </EmptyState>
    </div>
  )
}
