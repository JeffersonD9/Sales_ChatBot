'use client'

import type { TenantDetail } from '@/queries/tenants'
import { Bot, ImageIcon, ListRestart, Loader2, Play, Send, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type DemoOutbound = {
  type: 'text' | 'image' | 'buttons' | 'list' | 'audio'
  content?: string
  text?: string
  url?: string
  caption?: string
  buttons?: Array<{ id: string; title: string }>
  buttonText?: string
  sections?: Array<{
    title: string
    rows: Array<{ id: string; title: string; description?: string }>
  }>
}

type DemoSession = {
  tenantSlug: string
  waFrom: string
  step: string
  data: Record<string, unknown>
  shownProducts: unknown[]
  lastActivity: number
  reactivationSent: boolean
  createdAt: number
}

type ChatItem =
  | { id: string; from: 'user'; text: string }
  | { id: string; from: 'bot'; reply: DemoOutbound }

type Props = {
  tenant: TenantDetail
}

const FLOW_LABELS: Record<string, string> = {
  sales_v1: 'Sales v1',
  mayoristas: 'Mayoristas',
  hollywood_store: 'Hollywood Store',
}

export function FlowDemoTab({ tenant }: Props) {
  const initialFlow =
    ((tenant.bot_config as Record<string, unknown>)?.flow_type as string) || 'sales_v1'
  const [flows, setFlows] = useState<string[]>([initialFlow])
  const [flowType, setFlowType] = useState(initialFlow)
  const [session, setSession] = useState<DemoSession | null>(null)
  const [items, setItems] = useState<ChatItem[]>([])
  const [message, setMessage] = useState('hola')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/admin/tenants/${tenant.slug}/flow-demo`)
      .then((res) => res.json())
      .then((json) => {
        const data = json.data as { flows?: string[]; currentFlow?: string } | undefined
        if (data?.flows?.length) setFlows(data.flows)
        if (data?.currentFlow) setFlowType(data.currentFlow)
      })
      .catch(() => setError('No pude cargar la lista de flows.'))
  }, [tenant.slug])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: 'end' })
  })

  async function sendDemo(text: string, interactive?: { id: string; title: string }) {
    const clean = text.trim()
    if (!clean || loading) return

    setLoading(true)
    setError(null)
    setMessage('')
    setItems((current) => [...current, { id: crypto.randomUUID(), from: 'user', text: clean }])

    try {
      const res = await fetch(`/api/admin/tenants/${tenant.slug}/flow-demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: clean,
          flowType,
          session,
          interactiveId: interactive?.id,
          interactiveTitle: interactive?.title,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error ejecutando demo')

      const data = json.data as { replies: DemoOutbound[]; session: DemoSession }
      setSession(data.session)
      setItems((current) => [
        ...current,
        ...data.replies.map((reply) => ({ id: crypto.randomUUID(), from: 'bot' as const, reply })),
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error ejecutando demo')
    } finally {
      setLoading(false)
    }
  }

  function resetDemo(nextFlow = flowType) {
    setFlowType(nextFlow)
    setSession(null)
    setItems([])
    setMessage('hola')
    setError(null)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">ViewDemo</h2>
              <p className="truncate text-xs text-muted-foreground">
                {FLOW_LABELS[flowType] ?? flowType} - estado: {session?.step ?? 'NEW'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => resetDemo()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent"
          >
            <ListRestart className="h-4 w-4" />
            Reiniciar
          </button>
        </div>

        <div className="h-[520px] space-y-3 overflow-y-auto bg-muted/30 p-4">
          {items.length === 0 && (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
              Envia "hola" para iniciar el flow seleccionado.
            </div>
          )}
          {items.map((item) =>
            item.from === 'user' ? (
              <div key={item.id} className="flex justify-end">
                <div className="max-w-[78%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {item.text}
                </div>
              </div>
            ) : (
              <BotReply
                key={item.id}
                reply={item.reply}
                onAction={(id, title) => sendDemo(title, { id, title })}
              />
            ),
          )}
          <div ref={scrollRef} />
        </div>

        <form
          className="flex gap-2 border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void sendDemo(message)
          }}
        >
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="Escribe como cliente..."
          />
          <button
            type="submit"
            disabled={loading || !message.trim()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
            title="Enviar"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </section>

      <aside className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <label
            className="text-xs font-medium uppercase text-muted-foreground"
            htmlFor="flow-demo-select"
          >
            Flow
          </label>
          <select
            id="flow-demo-select"
            value={flowType}
            onChange={(event) => resetDemo(event.target.value)}
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {flows.map((flow) => (
              <option key={flow} value={flow}>
                {FLOW_LABELS[flow] ?? flow}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => sendDemo('hola')}
            disabled={loading}
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Iniciar demo
          </button>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          Este demo captura las respuestas del sender y usa sesion local del navegador. No envia
          mensajes a WhatsApp.
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </aside>
    </div>
  )
}

function BotReply({
  reply,
  onAction,
}: { reply: DemoOutbound; onAction: (id: string, title: string) => void }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[84%] space-y-2 rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm">
        {reply.type === 'text' && <p className="whitespace-pre-wrap">{reply.content}</p>}
        {reply.type === 'image' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ImageIcon className="h-4 w-4" />
              Imagen
            </div>
            {reply.url && (
              <img
                src={reply.url}
                alt={reply.caption || 'Imagen del flow'}
                className="max-h-64 rounded-md object-cover"
              />
            )}
            {reply.caption && <p className="whitespace-pre-wrap">{reply.caption}</p>}
          </div>
        )}
        {reply.type === 'audio' && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Volume2 className="h-4 w-4" />
            <span className="break-all">{reply.url || 'Audio'}</span>
          </div>
        )}
        {reply.type === 'buttons' && (
          <div className="space-y-2">
            <p className="whitespace-pre-wrap">{reply.text}</p>
            <div className="flex flex-wrap gap-2">
              {reply.buttons?.map((button) => (
                <button
                  key={button.id}
                  type="button"
                  onClick={() => onAction(button.id, button.title)}
                  className="rounded-md border border-primary/40 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  {button.title}
                </button>
              ))}
            </div>
          </div>
        )}
        {reply.type === 'list' && (
          <div className="space-y-2">
            <p className="whitespace-pre-wrap">{reply.text}</p>
            {reply.sections?.map((section) => (
              <div key={section.title} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{section.title}</p>
                {section.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onAction(row.id, row.title)}
                    className="block w-full rounded-md border border-border px-2.5 py-2 text-left text-xs hover:bg-accent"
                  >
                    <span className="font-medium">{row.title}</span>
                    {row.description && (
                      <span className="block text-muted-foreground">{row.description}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
