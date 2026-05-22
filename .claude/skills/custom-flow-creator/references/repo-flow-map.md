# Repo Flow Map

Use this reference while creating or reviewing custom WhatsApp flows in this repo.

## Runtime Path

1. `apps/message-worker/processors/whatsappInboundProcessor.js` loads the tenant, session, and `flow_type`.
2. `apps/message-worker/core/flows/index.js` maps `flow_type` to an engine and declares `aiCapabilities`.
3. The selected engine mutates `session.step` and `session.data`.
4. `apps/message-worker/core/state/manager.js` persists the session after each inbound message.

The registry currently falls back to `sales_v1` for an unknown flow.

## Existing Flow Patterns

- `apps/message-worker/core/flows/sales-v1/engine.js`
  Retail catalog flow. Uses shared `STEP` values, catalog/order step modules, premium AI fallback, and product data.
- `apps/message-worker/core/flows/custom/mayoristas/engine.js`
  Compact custom wholesale engine. Good reference for a custom main menu and advisor/order request behavior.
- `apps/message-worker/core/flows/custom/hollywood-store/engine.js`
  Client-specific branching engine for wholesale/detail routes, storage-backed media, catalog links, order fields, image analysis, notifications, and order persistence.

Use the closest engine as the primary reference. Hollywood is the better reference for visual artifacts with media, branches, and an order form.

## Registration And Activation

New custom engine work normally touches:

- `apps/message-worker/core/flows/custom/<client-slug>/engine.js`
- `apps/message-worker/core/flows/index.js`

Activation is driven by `tenant.bot_config.flow_type`.

The dashboard mirrors available flow types in:

- `apps/dashboard/src/app/(dashboard)/tenants/[slug]/_components/config-tab.tsx`
- `apps/dashboard/src/app/api/admin/tenants/[slug]/bot-config/route.ts`
- `apps/dashboard/src/app/(dashboard)/tenants/[slug]/_components/tenant-detail-client.tsx` when a display label is useful

Check all three when an admin must select or configure the flow.

## Sender And Input Helpers

Read sender and parser helpers before inventing new message code:

- `apps/message-worker/core/whatsapp/parser.js`
- `apps/message-worker/core/whatsapp/sender.js`

Common engine-facing helpers include:

- `extractInput`
- `sendText`
- `sendImage`
- `sendAudio`
- `sendInteractiveButtons`
- `sendInteractiveList`

Use WhatsApp interactive controls for bounded options. Accept text aliases only where they improve recovery from manual replies.

## AI Capabilities

Registry `aiCapabilities` gates services passed into a flow. Current registry examples use `imageAnalysis`.

Also check tenant feature flags and the selected existing engine before adding AI behavior. A diagram that says "AI bot" does not automatically require free-form AI responses in the engine.

## State And Side Effects

Session storage schema supports a current step plus JSON data. Keep state names short enough for `sessions.step`.

For side effects, inspect existing local patterns:

- order writes in `sales-v1/steps/order.js`
- custom order write in `custom/hollywood-store/engine.js`
- notifier calls in custom engines and `packages/notifications`

Use tenant-aware DB access for tenant records. Keep confirmation copy consistent with persistence and notification behavior.

## Tests

Flow tests already exist in `tests/unit/core/flowEngine.test.js` for `sales_v1`.

For a custom flow, prefer focused tests around:

- first contact and menu
- each main branch transition
- reset command behavior
- invalid bounded and free-text inputs
- order confirmation or advisor notification
- media/AI branch behavior when used

Mock sender helpers and notifier calls rather than invoking real WhatsApp integrations.

## Source Artifact Notes

Visual artifacts often omit runtime rules. Resolve or state assumptions for:

- fallback after invalid input
- reset command behavior
- direct-media limits and order of media sends
- exact fields persisted to orders
- totals, stock, shipping, payment states, and advisor SLAs
- when a branch rejoins another branch
