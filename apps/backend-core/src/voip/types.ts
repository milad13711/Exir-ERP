/**
 * A central gateway, not a single vendor integration: this file is the
 * entire contract between the VoIP module (which knows nothing about any
 * specific PBX) and one provider's adapter (see providers/*.provider.ts).
 * Adding support for a new phone system means adding one adapter file that
 * implements this interface and registers itself — never touching the
 * gateway/webhook/socket plumbing.
 */

export type IncomingCallEvent = {
  /** The caller's number, in whatever format the provider sends it — normalized later when matching against CrmContact.phone. */
  fromNumber: string;
  /** The internal extension that was dialed — looked up against VoipExtension to find which user gets the popup. */
  toExtension: string;
  /** Provider's own call id, opaque to us — kept only for logging/troubleshooting, and for matching a later "call ended" event to this same call. */
  callId: string;
};

/**
 * A "call ended" event — optional because most providers don't (yet)
 * confirm they send one, or what shape it has. `recordingUrl` is only ever
 * populated when the provider's own payload actually carries one; this
 * module never guesses or fabricates a recording location.
 */
export type CallEndedEvent = {
  callId: string;
  durationSeconds?: number;
  recordingUrl?: string;
  status?: 'ANSWERED' | 'MISSED' | 'NO_ANSWER' | 'FAILED';
};

export type OriginateResult = { success: true; callId?: string } | { success: false; error: string };

export type VoipProviderAdapter = {
  code: string;
  name: string;
  /** Shown in the settings UI so a tenant knows what to put in `config` (e.g. API base URL, API key) — free-form per provider. */
  configFields: Array<{ key: string; label: string }>;
  /**
   * Turns one webhook call's raw body into a normalized incoming-call event,
   * or null if this payload isn't a "call started" event this provider also
   * uses the same webhook URL for (e.g. call-ended events should be ignored
   * here, not error out).
   */
  parseWebhook(rawBody: unknown): IncomingCallEvent | null;
  /** Same webhook URL, but for a "call ended" payload — omitted for a provider that doesn't (confirmed to) send one. */
  parseCallEndedWebhook?: (rawBody: unknown) => CallEndedEvent | null;
  /** Click-to-call — omitted entirely for a provider that doesn't support triggering outbound calls via API. */
  originateCall?: (config: Record<string, unknown>, fromExtension: string, toNumber: string) => Promise<OriginateResult>;
};
