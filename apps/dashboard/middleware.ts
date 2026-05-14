import { type NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/constants'

// Importamos solo desde constants.ts (sin imports Node.js) — compatible con Edge runtime.

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── IP whitelist (opcional) ───────────────────────────────────────────────
  const allowedIps = process.env.ALLOWED_IPS?.split(',')
    .map((ip) => ip.trim())
    .filter(Boolean) ?? []

  if (allowedIps.length > 0) {
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? ''
    if (!allowedIps.includes(clientIp)) {
      return new NextResponse('Acceso denegado', { status: 403 })
    }
  }

  // ── Rutas de auth: siempre públicas ──────────────────────────────────────
  if (pathname.startsWith('/api/auth/')) return NextResponse.next()

  const session = request.cookies.get(SESSION_COOKIE)

  // ── Rutas API admin: devolver 401 JSON (no redirect) ─────────────────────
  if (pathname.startsWith('/api/')) {
    if (!session?.value) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // ── Login: si ya hay cookie, redirigir al dashboard ───────────────────────
  if (pathname === '/login') {
    if (session?.value) return NextResponse.redirect(new URL('/', request.url))
    return NextResponse.next()
  }

  // ── Rutas protegidas: redirigir si no hay cookie ──────────────────────────
  // Nota: esto es una verificación rápida de existencia de cookie.
  // La validación real (DB, expiración, revocación) ocurre en el layout del
  // grupo (dashboard) → validateSession() en un Server Component.
  if (!session?.value) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Excluir archivos estáticos y _next internals
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
