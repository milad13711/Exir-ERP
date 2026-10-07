/**
 * Every event a webhook subscription can be registered for. Keep this in
 * sync with the actual `webhooks.dispatch(...)` call sites — an event
 * listed here that nothing ever dispatches is a subscription nobody's
 * webhook will ever fire for.
 */
export const WEBHOOK_EVENTS = [
  'crm.contact.created',
  'crm.deal.created',
  'crm.deal.stage_changed',
  'task.created',
  'warehouse.movement.created',
  'forms.submission.created',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
