// Archivo sin imports — puede ser importado desde middleware (Edge runtime) sin problemas.

export const SESSION_COOKIE = 'jst_session'

export const PANEL_USER_ROLES = ['superadmin', 'admin', 'viewer'] as const
export type PanelUserRole = (typeof PANEL_USER_ROLES)[number]
