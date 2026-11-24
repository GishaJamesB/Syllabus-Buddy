import { lazy, Suspense } from 'react'
import LearnerApp from './learner/LearnerApp'

const Diagnostics = lazy(() => import('./Diagnostics'))
const AuthorPage = import.meta.env.DEV ? lazy(() => import('./author/AuthorPage')) : null

export function routeFor(pathname: string): 'learner' | 'diagnostics' | 'author' {
  const path = pathname.replace(/\/+$/, '')
  if (path === '/diagnostics') return 'diagnostics'
  if (path === '/author' && AuthorPage) return 'author'
  return 'learner'
}

export default function App() {
  const route = routeFor(window.location.pathname)
  if (route === 'learner') return <LearnerApp />
  return (
    <Suspense fallback={null}>
      {route === 'author' && AuthorPage ? <AuthorPage /> : <Diagnostics />}
    </Suspense>
  )
}
