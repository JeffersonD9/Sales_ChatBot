import type { NextRequest } from 'next/server'

/**
 * Devuelve la IP real del cliente cuando la app corre detrás de nginx.
 *
 * Why: nginx setea `X-Real-IP` con `$remote_addr` (peer TCP, no falsificable),
 * mientras que `X-Forwarded-For` usa `$proxy_add_x_forwarded_for`, que añade
 * la IP al header que envíe el cliente. `split(',')[0]` sobre XFF tomaría la
 * IP falsificada por el atacante y permitiría bypass de rate limit.
 */
export function getClientIp(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    const last = parts[parts.length - 1]
    if (last) return last
  }

  return 'unknown'
}
