import { clearCookieOptions, revokeCurrentSession } from '@/lib/auth'
import { SESSION_COOKIE } from '@/lib/constants'
import { NextResponse } from 'next/server'

export async function POST() {
  await revokeCurrentSession('logout')

  const response = NextResponse.json({ data: null })
  response.cookies.set(SESSION_COOKIE, '', clearCookieOptions)
  return response
}
