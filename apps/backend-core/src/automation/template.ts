import type { TriggerPayload } from './types.js';

/** Replaces every `{key}` in `template` with the matching payload value; an unknown key is left as-is (better a visible mistake than a silently swallowed one). */
export function renderTemplate(template: string, payload: TriggerPayload): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = payload[key];
    return value === null || value === undefined ? match : String(value);
  });
}
