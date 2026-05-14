import { NextResponse } from 'next/server'
import { revokeCurrentSession, clearCookieOptions } from '@/lib/auth'
import { SESSION_COOKIE } from '@/lib/constants'

export async function POST() {
  await revokeCurrentSession('logout')

  const response = NextResponse.json({ data: null })
  response.cookies.set(SESSION_COOKIE, '', clearCookieOptions)
  return response
}
