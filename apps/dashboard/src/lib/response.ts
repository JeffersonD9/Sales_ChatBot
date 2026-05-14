import { NextResponse } from 'next/server'
import type { ApiError, ApiSuccess, PaginationMeta } from '@/types/api'

export function ok<T>(data: T, meta?: PaginationMeta, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ data, ...(meta && { meta }) }, { status })
}

export function created<T>(data: T) {
  return ok(data, undefined, 201)
}

export function err(message: string, status = 400, details?: unknown) {
  return NextResponse.json<ApiError>({ error: message, ...(details && { details }) }, { status })
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

export function serverError(e: unknown) {
  console.error('[API Error]', e)
  return err('Error interno del servidor', 500)
}
