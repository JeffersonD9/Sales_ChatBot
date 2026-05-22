'use client'

import { formatRelativeTime } from '@/lib/utils'
import type { TenantDetail } from '@/queries/tenants'
import { Copy, RefreshCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

type Props = {
  tenant: TenantDetail
}

type Provider = 'meta' | '360dialog'

const INPUT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
const SELECT =
  'flex h-9 w-full cursor-pointer rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
const BUTTON =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-50'
const SECONDARY_BUTTON = `${BUTTON} border border-border text-foreground hover:bg-muted`

function randomVerifyToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function Field({
  label,
  hint,
  children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-foreground">{label}</div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border pb-1.5 pt-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {children}
      </h3>
    </div>
  )
}

export function WhatsappTab({ tenant }: Props) {
  const router = useRouter()
  const webhookUrl = `https://jestsolution.tech/webhook/${tenant.slug}`
  const configuredProvider = (tenant.bot_config.whatsapp_provider as Provider | undefined) ?? 'meta'

  const [verifyToken, setVerifyToken] = useState(tenant.verify_token)
  const [phoneNumberId, setPhoneNumberId] = useState(tenant.phone_number_id ?? '')
  const [accessToken, setAccessToken] = useState('')
  const [provider, setProvider] = useState<Provider>(configuredProvider)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copiado`)
    } catch {
      toast.error(`No se pudo copiar ${label.toLowerCase()}`)
    }
  }

  async function generateToken() {
    const nextToken = randomVerifyToken()
    setIsGenerating(true)
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.slug}/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verify_token: nextToken }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Error')
        return
      }
      setVerifyToken(nextToken)
      toast.success('Verify Token generado')
      router.refresh()
    } catch {
      toast.error('Error de conexion')
    } finally {
      setIsGenerating(false)
    }
  }

  async function saveCredentials(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)

    const payload: Record<string, string | null> = {
      phone_number_id: phoneNumberId.trim() || null,
      provider,
    }
    if (accessToken) payload.access_token = accessToken

    try {
      const res = await fetch(`/api/admin/tenants/${tenant.slug}/whatsapp`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Error')
        return
      }
      setAccessToken('')
      toast.success('Credenciales WhatsApp guardadas')
      router.refresh()
    } catch {
      toast.error('Error de conexion')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-4 pb-6">
      <SectionTitle>Webhook</SectionTitle>
      <Field
        label="Callback URL"
        hint="Pegá esta URL en Meta Developer → WhatsApp → Configuration → Webhook → Callback URL."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input readOnly value={webhookUrl} className={INPUT} />
          <button
            type="button"
            onClick={() => copyValue(webhookUrl, 'Webhook')}
            className={SECONDARY_BUTTON}
          >
            <Copy className="h-4 w-4" />
            Copiar
          </button>
        </div>
      </Field>

      <SectionTitle>Verify Token</SectionTitle>
      <Field label="Token de verificación" hint="Pegá este valor en Meta Developer → Verify Token.">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input readOnly value={verifyToken ?? '(sin generar)'} className={INPUT} />
          <button
            type="button"
            onClick={generateToken}
            disabled={isGenerating}
            className={SECONDARY_BUTTON}
          >
            <RefreshCcw className="h-4 w-4" />
            Generar
          </button>
          <button
            type="button"
            onClick={() => verifyToken && copyValue(verifyToken, 'Verify Token')}
            disabled={!verifyToken}
            className={SECONDARY_BUTTON}
          >
            <Copy className="h-4 w-4" />
            Copiar
          </button>
        </div>
      </Field>

      <form onSubmit={saveCredentials} className="space-y-4">
        <SectionTitle>Credenciales Meta</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Phone Number ID">
            <input
              value={phoneNumberId}
              onChange={(event) => setPhoneNumberId(event.target.value)}
              maxLength={64}
              className={INPUT}
            />
          </Field>
          <Field label="Proveedor">
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as Provider)}
              className={SELECT}
            >
              <option value="meta">Meta</option>
              <option value="360dialog">360dialog</option>
            </select>
          </Field>
        </div>
        <Field label="Access Token">
          <input
            type="password"
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
            placeholder={
              tenant.wa_token_encrypted
                ? '••• ya configurado (escribir para reemplazar)'
                : 'Pegá el access token de Meta'
            }
            className={INPUT}
          />
        </Field>
        <button
          type="submit"
          disabled={isSaving}
          className={`${BUTTON} bg-primary px-6 text-primary-foreground hover:bg-primary/90`}
        >
          Guardar
        </button>
      </form>

      <SectionTitle>Status</SectionTitle>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
            tenant.meta_live
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {tenant.meta_live ? '✓ Conectado' : '○ Sin tráfico aún'}
        </span>
        {tenant.meta_connected_at && (
          <span className="text-muted-foreground">
            Primer tráfico {formatRelativeTime(tenant.meta_connected_at)}
          </span>
        )}
      </div>
    </div>
  )
}
