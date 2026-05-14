import { Suspense } from 'react'
import type { Metadata } from 'next'
import LoginForm from './login-form'

export const metadata: Metadata = {
  title: 'Iniciar sesión',
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-8 px-4">
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <span className="text-2xl">💬</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            JestSolution
          </h1>
          <p className="text-sm text-muted-foreground">Panel Administrativo</p>
        </div>

        {/* useSearchParams requiere Suspense en Next.js 15 */}
        <Suspense fallback={<LoginFormSkeleton />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}

function LoginFormSkeleton() {
  return (
    <div className="space-y-4 w-full">
      <div className="h-9 rounded-md bg-muted animate-pulse" />
      <div className="h-9 rounded-md bg-muted animate-pulse" />
      <div className="h-9 rounded-md bg-muted animate-pulse" />
    </div>
  )
}
