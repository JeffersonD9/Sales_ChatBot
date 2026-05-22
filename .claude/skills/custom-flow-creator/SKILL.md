---
name: custom-flow-creator
description: Analyze visual or written client flow artifacts and create custom WhatsApp conversation flows for this whatsapp-saas repo. Use when the user provides HTML, Canva exports, screenshots, PDFs, node diagrams, chat scripts, or prose and asks to assess viability, design, scaffold, implement, test, or configure a client-specific flow under apps/message-worker/core/flows/custom.
---

# Custom Flow Creator

Create custom WhatsApp flows for this repo from client artifacts in Claude Code while keeping flow behavior explicit, testable, and aligned with the existing worker runtime.

Invoke this project skill directly as `/custom-flow-creator` when the user wants the workflow applied on demand. Let Claude Code load it automatically when a request matches the frontmatter description.

## Core Decision

Treat HTML, Canva exports, PDFs, screenshots, and node diagrams as source artifacts for interpretation. Do not treat them as executable flow definitions and do not build an artifact parser unless the user explicitly asks for a configurable runtime or importer.

Prefer this order:

1. Reuse an existing flow and tenant config when behavior already fits.
2. Create a client-specific engine under `apps/message-worker/core/flows/custom/<client-slug>/` when the behavior is real but not yet reusable.
3. Recommend a generic JSON runtime only after repeated custom flows reveal stable reusable blocks.

Read [references/repo-flow-map.md](references/repo-flow-map.md) before implementing or reviewing a flow in this repo.

## Choose The Mode

Infer the mode from the user request.

- For "analyze", "review first", "viability", "how would it work", or ambiguous visual artifacts: analyze only. Do not edit runtime code unless the user asks.
- For "create", "implement", "add this flow", or "make the custom flow": analyze the artifact briefly, state any assumptions that affect behavior, then implement end to end.
- For "update this custom flow": inspect the existing engine, registry, config surface, and tests before changing behavior.

Ask a question only when missing information would make the result wrong or risky. Otherwise make conservative assumptions and name them.

## Artifact Analysis

Extract a normalized flow spec before implementation. Use the template in [assets/custom-flow-spec-template.md](assets/custom-flow-spec-template.md) when a durable client spec is useful.

From the source artifact identify:

- client name, client slug, and desired `flow_type`
- entry greeting, reset commands, main menu, and fallback behavior
- branches, expected responses, button/list candidates, and free-text inputs
- session states and transitions
- data to collect into `session.data`
- order, lead, advisor, or other side effects
- media requirements: catalog links, direct images, audio, storage paths, captions
- AI capabilities: image analysis, audio transcription, free-form AI fallback
- tenant config needed in `bot_config`
- validations and invalid-input loops
- open gaps where the diagram describes a result without runtime rules

When comparing a diagram with code, call out meaningful mismatches. For example, a visual order summary may promise a total while an engine only persists `total: 0`.

## Analysis Output

For analysis-only requests, answer with:

1. What the artifact describes.
2. What already exists in the repo that matches it.
3. Viability: reuse, custom engine, or future generic runtime.
4. Proposed branches and states.
5. Required config/assets and expected side effects.
6. Risks, missing rules, and the next coding step.

Keep the recommendation concrete. Say clearly when a custom engine still has to be coded by hand.

## Implementation Workflow

Follow this sequence for a new custom engine:

1. Inspect `apps/message-worker/core/flows/index.js`, one closest existing engine, worker dispatch, WhatsApp sender helpers, state persistence, relevant dashboard config, and tests.
2. Create or update the client spec when the source artifact is likely to be reused or revised later.
3. Add `apps/message-worker/core/flows/custom/<client-slug>/engine.js`.
4. Register the flow in `apps/message-worker/core/flows/index.js` with the smallest `aiCapabilities` set it needs.
5. Make the flow selectable/configurable in the dashboard only when admins need to activate or operate it.
6. Extend API validation for added dashboard operational fields.
7. Add focused tests for first contact, branch transitions, invalid input handling, order/advisor side effects, reset behavior, and custom capabilities that carry risk.
8. Run focused tests first; broaden verification when registry, shared config, or dashboard validation changed.

If the user asks only for a spec or scaffold, stop at that scope and say what runtime work remains.

## Engine Rules

Keep custom engines explicit.

- Export `processMessage(phone, rawMsg, session, tenant, notifier, services)`.
- Use `extractInput` and sender helpers from the worker instead of parsing WhatsApp payloads ad hoc.
- Give local custom steps a client prefix when they are not shared steps.
- Store conversational state in `session.step` and captured fields in `session.data`.
- Support reset/menu commands unless the user requires a different behavior.
- Validate free-text inputs before advancing state.
- Prefer interactive buttons/lists for bounded choices and text input for open fields.
- Use `services.ai` only for capabilities declared in the registry and allowed by tenant features.
- Use tenant-aware data access patterns already present in the repo for saved orders or other writes.
- Keep client-specific prices, copy, and asset paths either in a clear engine constant or explicit `bot_config` fields. Do not hide rules in visual artifact comments.

## Config Rules

Use `bot_config` for operational values that admins must change per tenant, such as storage base URLs, catalog links, media counts, provider flags, and feature flags.

When adding operational config through the dashboard:

- update the dashboard flow option and `flow_type` schema
- update `apps/dashboard/src/app/api/admin/tenants/[slug]/bot-config/route.ts`
- show fields only for the flow that consumes them when they are client-specific
- keep worker defaults safe when config is missing

Avoid turning `bot_config` into an unvalidated arbitrary graph runtime during custom-engine work.

## Side Effects And Safety

Make side effects deliberate.

- Confirm when a flow should notify the owner, ask for an advisor, save an order, or only collect a lead.
- Do not promise computed totals, stock checks, or payment confirmation unless implemented.
- Keep customer-facing confirmation text consistent with what the worker actually persisted or notified.
- Preserve multi-tenant boundaries and use tenant context for tenant data access.

## Deliverables

For implementation work, leave the user with:

- files changed and flow activation value
- required `bot_config` fields and assets
- tests run and any verification not run
- assumptions that affect client behavior

## Typical Requests

- "Use this Hollywood HTML as the reference and create a custom flow for Client X."
- "Analyze this Canva export first and tell me if it fits an existing flow."
- "Make a custom flow with branches wholesale and retail, then collect order reference, size, quantity, address, and payment."
- "Update this flow so images are sent from tenant storage and image analysis can route into the order form."
