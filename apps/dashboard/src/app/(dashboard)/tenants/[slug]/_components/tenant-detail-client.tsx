'use client'

import type { ProductRow } from '@/queries/products'
import type { TenantDetail } from '@/queries/tenants'
import { MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { ConfigTab } from './config-tab'
import { PersonaTab } from './persona-tab'
import { ProductsTab } from './products-tab'
import { WhatsappTab } from './whatsapp-tab'

type Tab = 'products' | 'persona' | 'whatsapp' | 'config'

type Props = {
  tenant: TenantDetail
  products: ProductRow[]
}

const FLOW_LABELS: Record<string, string> = {
  sales_v1: '🛍️ Sales v1',
  mayoristas: '📦 Mayoristas',
  hollywood_store: '🎬 Hollywood',
}

export function TenantDetailClient({ tenant, products }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('products')

  const flowType = (tenant.bot_config as Record<string, unknown>)?.flow_type as string | undefined
  const flowLabel = flowType ? (FLOW_LABELS[flowType] ?? flowType) : 'Sales v1'

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex border-b border-border">
        <TabButton active={activeTab === 'products'} onClick={() => setActiveTab('products')}>
          Productos
          <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
            {products.filter((p) => p.active).length}
          </span>
        </TabButton>
        <TabButton active={activeTab === 'persona'} onClick={() => setActiveTab('persona')}>
          Persona IA
        </TabButton>
        <TabButton active={activeTab === 'whatsapp'} onClick={() => setActiveTab('whatsapp')}>
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </TabButton>
        <TabButton active={activeTab === 'config'} onClick={() => setActiveTab('config')}>
          Configuración
          <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground font-mono">
            {flowLabel}
          </span>
        </TabButton>
      </div>

      {/* Tab content */}
      {activeTab === 'products' && <ProductsTab tenantSlug={tenant.slug} products={products} />}
      {activeTab === 'persona' && (
        <PersonaTab tenantSlug={tenant.slug} botConfig={tenant.bot_config} products={products} />
      )}
      {activeTab === 'whatsapp' && <WhatsappTab tenant={tenant} />}
      {activeTab === 'config' && (
        <ConfigTab tenantSlug={tenant.slug} botConfig={tenant.bot_config} />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
