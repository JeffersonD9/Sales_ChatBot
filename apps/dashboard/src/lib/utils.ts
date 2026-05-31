import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(cents: number, currency = 'COP'): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(cents)
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date))
}

export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'ahora mismo'
  if (diffMin < 60) return `hace ${diffMin}m`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `hace ${diffH}h`
  const diffD = Math.floor(diffH / 24)
  return `hace ${diffD}d`
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Normaliza un teléfono a E.164 (`+<digits>`, 7-15 dígitos, primer 1-9).
 * Devuelve null si el input no se puede mapear a un E.164 sintácticamente válido.
 * Acepta entradas con espacios, guiones, paréntesis, puntos y prefijo `00`.
 *
 * Mantener sincronizado con packages/shared-utils/phoneE164.js.
 */
export function normalizePhoneE164(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  let cleaned = input.trim()
  if (!cleaned) return null
  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`
  const digits = cleaned.replace(/[^\d]/g, '')
  if (!digits) return null
  const canonical = `+${digits}`
  return /^\+[1-9]\d{6,14}$/.test(canonical) ? canonical : null
}

export function isValidPhoneE164(input: string | null | undefined): boolean {
  return normalizePhoneE164(input) !== null
}
