import type { TenantRequestContext } from '../common/request-context.js';

/**
 * The type of one field in a trigger's payload — determines which action
 * configs can target it (e.g. only a USER_ID field can be picked as a
 * notification recipient, only PHONE for SMS). This is the whole contract
 * that lets the automation engine stay ignorant of what any given module's
 * trigger actually means.
 */
export type PayloadFieldType = 'STRING' | 'NUMBER' | 'USER_ID' | 'PHONE';

export type TriggerPayloadField = {
  key: string;
  label: string;
  type: PayloadFieldType;
};

/** The actual values a trigger fires with — one flat object keyed by each declared payload field's `key`. */
export type TriggerPayload = Record<string, string | number | null>;

/**
 * A trigger a module registers into TriggerRegistryService at boot. The
 * automation module never imports or knows about the owning module's code —
 * this object (plus, optionally, `resolvePayload` for manual re-firing) is
 * the entire surface between them.
 */
export type TriggerDefinition = {
  code: string;
  moduleCode: string;
  label: string;
  description?: string;
  payloadFields: TriggerPayloadField[];
  /**
   * Lets a trigger support the "fire this manually" button: given an entity
   * id (whatever that means for this trigger — a production order id, an
   * invoice id, ...), rebuilds the same payload shape the automatic path
   * would produce. Triggers without this are automatic-only.
   */
  resolvePayload?: (ctx: TenantRequestContext, entityId: string) => Promise<TriggerPayload>;
};
