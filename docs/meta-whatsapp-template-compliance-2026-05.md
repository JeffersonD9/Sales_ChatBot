# Meta WhatsApp templates: approval, delivery and anti-ban checklist

> Snapshot verified: 2026-05-23. Use this as the required checklist before creating or editing any custom flow, template library, campaign, webhook handler or outbound automation.

## Source links to re-check before launch

Primary references:

- WhatsApp Business Messaging Policy: https://whatsappbusiness.com/policy/
- WhatsApp Messaging Guidelines: https://www.whatsapp.com/legal/messaging-guidelines
- WhatsApp Business Platform pricing and message categories: https://whatsappbusiness.com/products/platform-pricing/
- WhatsApp marketing messages category: https://whatsappbusiness.com/products/conversation-categories/marketing/
- WhatsApp utility messages category: https://whatsappbusiness.com/products/conversation-categories/utility/
- WhatsApp authentication messages category: https://whatsappbusiness.com/products/conversation-categories/authentication/
- WhatsApp service messages category: https://whatsappbusiness.com/products/conversation-categories/service/
- WhatsApp Business Platform onboarding best practices PDF: https://whatsappbusiness.com/wp-content/uploads/2026/04/Onboarding-to-the-WhatsApp-Business-Platform.pdf
- Meta WhatsApp Business Messaging Policy: https://developers.facebook.com/docs/whatsapp/overview/business-messaging-policy
- Meta Message Template Guidelines: https://developers.facebook.com/docs/whatsapp/message-templates/guidelines
- Meta Messaging Limits: https://developers.facebook.com/docs/whatsapp/messaging-limits
- Meta Cloud API Error Codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
- Meta message template status webhook reference: https://developers.facebook.com/docs/whatsapp/webhooks/reference/message_template_status_update
- Meta Account Quality dashboard: https://business.facebook.com/accountquality
- 360dialog quality docs: https://docs.360dialog.com/whatsapp-api/whatsapp-api/quality

Useful secondary checks when Meta docs move or render poorly:

- 360dialog template docs: https://docs.360dialog.com/docs/waba-basics/templates
- Customer.io WhatsApp best practices: https://customer.io/learn/mobile-marketing/whatsapp-best-practices
- Manychat US marketing template pause note: https://help.manychat.com/hc/en-us/articles/19328856186780-Temporary-pause-on-WhatsApp-Marketing-Templates-in-the-US

## Non-negotiable product rules

1. No outbound business-initiated message without valid WhatsApp opt-in proof.
2. Outside the 24-hour customer service window, use only approved templates.
3. Do not hide marketing inside a utility template. If it sells, re-engages, promotes, cross-sells, announces discounts, or asks the user to browse/buy, it is marketing.
4. Use current category names only: `MARKETING`, `UTILITY`, `AUTHENTICATION`, and service messages inside the 24-hour customer service window. Do not use the old `TRANSACTIONAL` wording in new docs or code.
5. Authentication use cases must use authentication templates and OTP buttons, not custom marketing or utility copy.
6. Service messages are replies to user-initiated conversations inside the 24-hour customer service window; the window resets with each user message.
7. Meta/WhatsApp can review, approve, reject or pause templates at any time. Treat template state as runtime config, not as a one-time approval.
8. The business profile and display name must accurately represent the business and match external branding. Mismatched names/content are a policy risk.
9. Regulated verticals need extra review before any template or flow: alcohol, tobacco, gambling, medical/healthcare, drugs, financial/debt products, adult/dating, MLM, weapons, hazardous goods, live animals and other restricted commerce categories.
10. Any user opt-out must be honored immediately and persistently.
11. Every custom flow must have a visible human handoff path.
12. Every flow must stop after too many outbound messages without a user reply. The runtime guard currently defaults to 3 messages.
13. Webhooks must be treated as control signals, not just chat input. Failed statuses, template pauses, disabled templates, quality updates and opt-outs must change sending behavior.
14. Never retry template format or hydration errors blindly. Fix the template or payload first.
15. No promise in a bot message unless the system can actually verify it: stock, delivery time, price, discount, payment status and order status.

## Template approval checklist

Before submitting a template to Meta:

- Category is correct: `UTILITY`, `MARKETING` or `AUTHENTICATION`. Service messages do not use templates when they are inside the 24-hour user-initiated service window.
- Template name is specific, lowercase and versioned, for example `order_confirmed_v1`.
- Body has clear context for why the user receives it.
- Variables are real personalization or transaction data, not a way to smuggle unreviewed promotional copy.
- Template does not start or end with a variable.
- Variables are not adjacent without text between them.
- Sample values are realistic and safe.
- Marketing templates include an easy exit path, preferably a quick reply such as `No gracias` or text like `Responde STOP para salir`.
- Utility templates do not include discounts, cross-sell, "new arrivals", coupons, urgency or catalog browsing.
- Links point to an established domain owned by the brand. Avoid new, suspicious, redirected or mismatched domains.
- Media templates use product/order-specific media, not generic stock-style images.
- CTA is conversational and low-pressure.

High-risk copy to avoid:

- Excessive urgency: `solo hoy`, `ultimas horas`, `compra ahora`.
- Money/guarantee claims: `100% garantizado`, `gana dinero`, `ingreso extra`.
- Aggressive link prompts: `haz clic aqui`, especially in caps.
- All-caps promo phrasing or repeated punctuation.
- Generic bulk messages with no user-specific context.

Safer CTA patterns:

- `Responde SI para confirmar.`
- `Quieres que te muestre opciones?`
- `Escribenos si te interesa.`
- `Necesitas cambiar algun dato?`

## Sending and delivery rules

- Start with the most engaged segment and warm up volume gradually.
- Keep campaign volume below operational limits even if the account tier allows more.
- Respect local recipient time. Default safe window: 9:00 to 20:00 local time.
- Segment by recent engagement. Cold or old databases are the fastest path to reports.
- Do not send identical blasts without meaningful segmentation.
- Use quick replies when possible; they increase reply probability and reduce ambiguity.
- Stop or reduce marketing immediately on quality drops, `131048`, `131049`, template pauses or abnormal failed statuses.
- If a template is rejected, redesign the intent and structure. Do not resubmit with two-word changes.
- If a template is paused or disabled, stop all sends that reference it until manual review.
- Pricing is per delivered message, not merely per API attempt. Categories affect cost and policy review.
- Utility and authentication can unlock volume pricing tiers; do not let pricing incentives push promotional content into utility templates.

## Category quick reference

| Category | Official intent | Safe examples | Common mistake |
| --- | --- | --- | --- |
| `MARKETING` | Awareness, sales, promotions, recommendations, re-engagement, abandoned cart, loyalty offers. | Product recommendations, coupons, price drops, birthday offers, win-back. | Calling a promotion "utility" because the user once bought. |
| `UTILITY` | User-triggered or critical updates during/after a purchase, payment, account, delivery, opt-in/out or feedback flow. | Order confirmation, delivery update, payment reminder, account alert, feedback after a completed order. | Adding discount, catalog, upsell or "new collection" text. |
| `AUTHENTICATION` | OTP and identity verification. | Login code, account recovery, transaction verification. | Sending OTP-like text through utility or marketing. |
| `SERVICE` | User-initiated support inside the 24-hour customer service window. | Human/AI support answer, appointment reminder requested by user, order question reply. | Continuing free-form outreach after the 24-hour window closes. |

## Webhook requirements

Every `POST /webhook/:slug` payload can include messages, message statuses, template status updates or quality signals. The app must keep these behaviors:

- For inbound user messages:
  - reset outbound-without-reply counters;
  - detect opt-out keywords;
  - detect human-support keywords;
  - keep logs with tenant, phone and message id.
- For `statuses` with `failed`:
  - inspect `errors[0].code`;
  - apply the anti-ban action table;
  - never retry template payload errors without a payload/template fix.
- For template status changes:
  - `APPROVED`: allow use only after the template library maps the approved name/language/category.
  - `REJECTED`: block use and redesign.
  - `PAUSED`: pause campaigns using that template.
  - `DISABLED`: remove from active flows until recreated and approved.
  - `FLAGGED`: treat as a production incident and reduce volume.
- For template quality updates:
  - Green/high: continue.
  - Yellow/medium: reduce volume and review segment/copy.
  - Red/low: pause marketing and inspect opt-ins, complaints and failed statuses.

## Error handling map

Current must-handle codes:

| Code | Meaning in practice | Required action |
| --- | --- | --- |
| `130429` | Rate limit | Back off and reduce rate. |
| `131031` | Account locked/restricted | Stop sending and escalate. |
| `131047` | Outside customer service window without valid template | Use an approved template or wait for user reply. |
| `131048` | Spam rate limit | Pause campaigns and review targeting. |
| `131049` | Delivery blocked for ecosystem/quality reasons | Reduce rate, review template and segment. |
| `131050` | User opted out of marketing | Suppress marketing to this recipient. |
| `132000` | Template parameter count mismatch | Fix payload; do not retry as-is. |
| `132001` | Template does not exist or is unavailable | Verify name, language and approval. |
| `132005` | Hydrated template text too long | Shorten variables/body. |
| `132007` | Template format character policy issue | Fix template text/format. |
| `132012` | Template parameter format mismatch | Fix component parameter types. |
| `132015` | Template paused | Stop using the template. |
| `132016` | Template disabled | Remove from active sends. |
| `132068` | Flow blocked | Stop the Flow and review quality/policy issue. |
| `132069` | Flow throttled | Reduce Flow send rate. |

## Custom flow creation checklist

Every new file under `apps/message-worker/core/flows/custom/<slug>/engine.js` must pass this checklist before being registered in `flows/index.js`:

- It starts from a user message or an approved template, never from arbitrary free-form outreach.
- It uses short WhatsApp-native copy, not email-style paragraphs.
- It offers menu/buttons where the user can answer easily.
- It has an advisor/human route.
- It does not send more than 3 consecutive outbound messages without user input.
- It does not send marketing claims in utility/order steps.
- It does not continue sending after opt-out or support escalation.
- It validates user inputs before promising price, stock, delivery, payment or availability.
- It avoids hardcoded external links unless they are established, brand-owned and configured per tenant.
- It documents any template names it depends on, with category and language.
- It relies on `sendText`, `sendImage`, `sendInteractiveButtons`, `sendInteractiveList` or `sendAudio` so `antiBanGuard` runs before every outbound message.

## Existing runtime protections in this repo

- `packages/platform-data/src/integrations/whatsapp/antiBanGuard.js`:
  - suppression list;
  - opt-out detection;
  - human-support keyword detection;
  - outbound-without-reply circuit breaker;
  - optional send window by recipient timezone;
  - adaptive rate reduction for known Meta error codes.
- `apps/message-worker/processors/whatsappInboundProcessor.js`:
  - handles inbound messages asynchronously after the webhook has already returned `200`;
  - calls the anti-ban inbound guard before dispatching to flows;
  - must also inspect message status failures and template status signals.

This checklist reduces risk; it does not guarantee approval or immunity from restrictions. Meta can change review, quality and delivery rules without notice, so re-check the source links before major launches or high-volume sends.
