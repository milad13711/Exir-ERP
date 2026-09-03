import type { TriggerPayload } from './types.js';

/**
 * The three action types v1 supports — deliberately not "create any
 * record": Task is already this codebase's generic cross-module record
 * (see Task.relatedModule/relatedEntityId), so "create a record" and
 * "create a task" are the same thing here, with no new modeling needed
 * per module.
 */
export type NotifyInAppConfig = {
  type: 'NOTIFY_IN_APP';
  targetMode: 'FIXED' | 'FIELD';
  fixedUserId?: string;
  payloadField?: string;
  title: string;
  body: string;
  link?: string;
};

export type SendSmsConfig = {
  type: 'SEND_SMS';
  phoneMode: 'FIXED' | 'FIELD';
  fixedPhone?: string;
  payloadField?: string;
  message: string;
};

export type CreateTaskConfig = {
  type: 'CREATE_TASK';
  assigneeMode: 'NONE' | 'FIXED' | 'FIELD';
  fixedUserId?: string;
  payloadField?: string;
  title: string;
  priority?: 'NORMAL' | 'MEDIUM' | 'URGENT';
};

export type AutomationActionConfig = NotifyInAppConfig | SendSmsConfig | CreateTaskConfig;

/**
 * Resolves a "who/what" target (a user id or a phone number) that an action
 * config points at, without the resolver knowing anything about what the
 * payload field actually means — only its declared type ever mattered, and
 * that was already checked when the rule was saved.
 */
export function resolveFixedOrFieldTarget(
  mode: string,
  fixedValue: string | undefined,
  payloadField: string | undefined,
  payload: TriggerPayload,
): string | null {
  if (mode === 'FIXED') return fixedValue ?? null;
  if (mode === 'FIELD' && payloadField) {
    const value = payload[payloadField];
    return value === null || value === undefined ? null : String(value);
  }
  return null;
}
