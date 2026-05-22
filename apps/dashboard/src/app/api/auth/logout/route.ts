import { clearCookieOptions, revokeCurrentSession } from '@/lib/auth'
import { SESSION_COOKIE } from '@/lib/constants'
import { serverError } from '@/lib/response'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    await revokeCurrentSession('logout')

    const response = NextResponse.json({ data: null })
    response.cookies.set(SESSION_COOKIE, '', clearCookieOptions)
    return response
  } catch (e) {
    return serverError(e, 'auth.logout')
  }
}
