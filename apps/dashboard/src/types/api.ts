// ── Respuestas genéricas de Route Handlers ────────────────────────────────────

export type ApiSuccess<T> = {
  data: T
  meta?: PaginationMeta
}

export type ApiError = {
  error: string
  details?: unknown
}

// ── Paginación ────────────────────────────────────────────────────────────────

export type PaginationMeta = {
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export type PaginationParams = {
  page: number
  pageSize: number
}

export type SortParams = {
  column: string
  direction: 'asc' | 'desc'
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export type LoginRequest = {
  username: string
  password: string
}

export type SessionUser = {
  id: string
  username: string
  email: string
  role: string
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export type DashboardStats = {
  tenants: {
    total: number
    active: number
    trial: number
    suspended: number
  }
  orders: {
    last_7d: number
    last_30d: number
    total_revenue_cents: number
  }
  sessions: {
    active_last_hour: number
    created_last_24h: number
  }
}
