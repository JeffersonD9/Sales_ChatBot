import { PageHeader } from '@/components/shared/page-header'
import { env } from '@/env'
import { validateSession } from '@/lib/auth'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { DbConsoleClient } from './db-console-client'

export const metadata: Metadata = { title: 'Consola DB' }

export default async function DbConsolePage() {
  const user = await validateSession()
  if (user?.role !== 'superadmin') redirect('/')

  return (
    <div className="space-y-5">
      <PageHeader
        title="Consola DB"
        description="Consultas controladas para diagnostico y correcciones puntuales."
      />
      <DbConsoleClient writesEnabled={env.DB_CONSOLE_WRITES_ENABLED} />
    </div>
  )
}
