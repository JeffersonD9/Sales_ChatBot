import type { ApiError, ApiSuccess, PaginationMeta } from '@/types/api'
import { NextResponse } from 'next/server'

export function ok<T>(data: T, meta?: PaginationMeta, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ data, ...(meta && { meta }) }, { status })
}

export function created<T>(data: T) {
  return ok(data, undefined, 201)
}

export function err(message: string, status = 400, details?: unknown) {
  const body: ApiError = details !== undefined ? { error: message, details } : { error: message }
  return NextResponse.json<ApiError>(body, { status })
}

export function unauthorized(message = 'No autenticado') {
  return err(message, 401)
}

export function forbidden(message = 'Sin permisos') {
  return err(message, 403)
}

export function notFound(resource = 'Recurso') {
  return err(`${resource} no encontrado`, 404)
}

export function serverError(e: unknown, context?: string) {
  // Loguea de forma explícita name/message/code/stack para que el mensaje real
  // sobreviva a la minificación de Next.js standalone + tree-shaking de Sentry.
  // Sin esto, en prod aparece "⨯ Error:" sin texto y es imposible diagnosticar.
  const tag = context ? `[API Error:${context}]` : '[API Error]'
  if (e instanceof Error) {
    console.error(tag, {
      name: e.name,
      message: e.message,
      code: (e as { code?: string }).code,
      stack: e.stack,
    })
  } else {
    console.error(tag, e)
  }
  return err('Error interno del servidor', 500)
}
