// Cliente HTTP hacia api-core para operaciones de media.
//
// El dashboard es standalone y NO puede importar packages/platform-data.
// Toda la lógica de storage (sharp, fs, adapter) vive en api-core, que monta
// el volumen media_data. Aquí solo reenviamos con la admin API key interna.

import { env } from '@/env'

const BASE = (env.API_CORE_INTERNAL_URL || 'http://api:3000').replace(/\/+$/, '')

function authHeaders(): Record<string, string> {
  const key = env.ADMIN_API_KEY
  if (!key) throw new Error('ADMIN_API_KEY no configurado en el dashboard')
  return { 'x-api-key': key }
}

export type MediaConfig = {
  enabled: boolean
  importProductsEnabled: boolean
  maxImageUploadMb: number
  maxAudioUploadMb: number
  allowedImageFormats: string[]
  allowedAudioFormats: string[]
  [key: string]: unknown
}

export type MediaItem = { relativePath: string; url: string; size: number; updatedAt: string }

async function parse(res: Response) {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error || `api-core ${res.status}`)
  return json
}

export const mediaClient = {
  async list(slug: string, type?: string): Promise<{ items: MediaItem[]; config: MediaConfig }> {
    const url = new URL(`${BASE}/api/admin/media/${slug}`)
    if (type) url.searchParams.set('type', type)
    return parse(await fetch(url, { headers: authHeaders(), cache: 'no-store' })) as Promise<{
      items: MediaItem[]
      config: MediaConfig
    }>
  },

  async upload(slug: string, scope: string, buffer: Buffer, contentType: string) {
    const url = new URL(`${BASE}/api/admin/media/${slug}`)
    url.searchParams.set('scope', scope)
    return parse(
      await fetch(url, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': contentType || 'application/octet-stream' },
        body: buffer,
      }),
    )
  },

  async remove(slug: string, relativePath: string) {
    const url = new URL(`${BASE}/api/admin/media/${slug}`)
    url.searchParams.set('path', relativePath)
    return parse(await fetch(url, { method: 'DELETE', headers: authHeaders() }))
  },

  async localize(slug: string, urls: string[]): Promise<{ map: Record<string, string> }> {
    return parse(
      await fetch(`${BASE}/api/admin/media/${slug}/localize`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      }),
    ) as Promise<{ map: Record<string, string> }>
  },
}

// Flags mínimos leídos del bot_config sin depender de platform-data.
export function mediaConfigFlags(botConfig: Record<string, unknown> | null | undefined): {
  enabled: boolean
  importProductsEnabled: boolean
} {
  const ms = (botConfig?.media_storage as Record<string, unknown> | undefined) ?? {}
  return {
    enabled: Boolean(ms.enabled),
    importProductsEnabled: Boolean(ms.importProductsEnabled),
  }
}
