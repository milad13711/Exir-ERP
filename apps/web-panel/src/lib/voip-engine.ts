"use client";

import { fetchVoipConnectionInfo, reportIncomingCall, reportOutgoingCall, endCall, fetchCrmContacts } from "./api";

// نوع Session از sip.js فقط برای تایپ داخلی لازم است؛ چون این ماژول همیشه
// در مرورگر اجرا می‌شود (نه در رندر سروری Next.js)، ایمپورت به‌صورت
// دینامیک انجام می‌شود تا خودِ کتابخانه (که به window/WebSocket نیاز دارد)
// هرگز روی سرور بار نشود.
type SipSession = {
  remoteIdentity: { uri: { user?: string; toString(): string }; friendlyName?: string };
};
type SipSessionManager = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  register(): Promise<void>;
  call(destination: string): Promise<void>;
  answer(session: SipSession): Promise<void>;
  decline(session: SipSession): Promise<void>;
  hangup(session: SipSession): Promise<void>;
  mute(session: SipSession): void;
  unmute(session: SipSession): void;
};

export type VoipCallState = "idle" | "ringing-incoming" | "ringing-outgoing" | "connected";
export type VoipConnectionStatus = "idle" | "connecting" | "registered" | "failed" | "unavailable";

export type VoipEngineState = {
  status: VoipConnectionStatus;
  callState: VoipCallState;
  remoteNumber: string | null;
  remoteName: string | null;
  muted: boolean;
  error: string | null;
};

type Listener = (state: VoipEngineState) => void;

/**
 * سافت‌فون مرورگری — دقیقاً همان چیزی که Odoo با همان لینک/یوزر/پسورد
 * تلفن IP انجام می‌دهد: SIP روی WebSocket با WebRTC برای صدا، مستقیم از
 * مرورگر به سانترال، بدون واسطه‌ی هیچ API اختصاصی ارائه‌دهنده. اگر تننت
 * آدرس WebSocket (wssUrl) را تنظیم نکرده باشد، این موتور بی‌خطر غیرفعال
 * می‌ماند و ویجت تلفن به originate سمت سرور برمی‌گردد.
 */
class VoipEngine {
  private sessionManager: SipSessionManager | null = null;
  private session: SipSession | null = null;
  private sipDomain = "";
  private callLogId: string | null = null;
  private callStartedAt: number | null = null;
  private wasAnswered = false;
  private audioEl: HTMLAudioElement | null = null;
  private listeners = new Set<Listener>();
  private initPromise: Promise<void> | null = null;

  state: VoipEngineState = {
    status: "idle",
    callState: "idle",
    remoteNumber: null,
    remoteName: null,
    muted: false,
    error: null,
  };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private setState(patch: Partial<VoipEngineState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }

  get isAvailable(): boolean {
    return this.state.status === "registered";
  }

  /** بی‌خطر برای صدازدن چندبار — فقط بار اول واقعاً وصل می‌شود. */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const info = await fetchVoipConnectionInfo().catch(() => null);
    if (!info?.wssUrl || !info.sipDomain || !info.sipUsername || !info.sipPassword) {
      this.setState({ status: "unavailable" });
      return;
    }

    this.setState({ status: "connecting" });
    this.sipDomain = info.sipDomain;
    this.audioEl = new Audio();
    this.audioEl.autoplay = true;

    try {
      const { SessionManager } = await import("sip.js/lib/platform/web");
      const aor = `sip:${info.sipUsername}@${info.sipDomain}`;
      this.sessionManager = new SessionManager(info.wssUrl, {
        aor,
        media: { remote: { audio: this.audioEl } },
        userAgentOptions: {
          authorizationUsername: info.sipUsername,
          authorizationPassword: info.sipPassword,
        },
        delegate: {
          onCallCreated: (session: SipSession) => {
            this.session = session;
          },
          onCallReceived: (session: SipSession) => this.handleIncoming(session),
          onCallAnswered: () => {
            this.wasAnswered = true;
            this.callStartedAt = Date.now();
            this.setState({ callState: "connected" });
          },
          onCallHangup: () => this.handleHangup(),
          onRegistered: () => this.setState({ status: "registered", error: null }),
          onUnregistered: () => this.setState({ status: "idle" }),
          onServerDisconnect: () => this.setState({ status: "failed", error: "اتصال به سرور تلفن قطع شد" }),
        },
      }) as unknown as SipSessionManager;

      await this.sessionManager.connect();
      await this.sessionManager.register();
    } catch {
      this.setState({ status: "failed", error: "اتصال سافت‌فون مرورگری ناموفق بود — آدرس WebSocket را در تنظیمات بررسی کنید" });
    }
  }

  private async handleIncoming(session: SipSession): Promise<void> {
    this.session = session;
    this.wasAnswered = false;
    const fromNumber = session.remoteIdentity.uri.user || session.remoteIdentity.uri.toString();
    this.setState({ callState: "ringing-incoming", remoteNumber: fromNumber, remoteName: session.remoteIdentity.friendlyName || null });

    const contactName = await fetchCrmContacts(fromNumber)
      .then((contacts) => contacts.find((c) => c.phone === fromNumber)?.name ?? null)
      .catch(() => null);
    if (contactName) this.setState({ remoteName: contactName });

    try {
      const log = await reportIncomingCall({ fromNumber });
      this.callLogId = log.id;
    } catch {
      this.callLogId = null;
    }
  }

  async call(toNumber: string, contactId?: string, contactName?: string): Promise<void> {
    if (!this.sessionManager) throw new Error("سافت‌فون مرورگری متصل نیست");
    this.wasAnswered = false;
    this.setState({ callState: "ringing-outgoing", remoteNumber: toNumber, remoteName: contactName ?? null });
    try {
      const log = await reportOutgoingCall({ toNumber, contactId });
      this.callLogId = log.id;
    } catch {
      this.callLogId = null;
    }
    await this.sessionManager.call(`sip:${toNumber}@${this.sipDomain}`);
  }

  async answer(): Promise<void> {
    if (!this.sessionManager || !this.session) return;
    await this.sessionManager.answer(this.session);
  }

  async decline(): Promise<void> {
    if (!this.sessionManager || !this.session) return;
    await this.sessionManager.decline(this.session);
  }

  async hangup(): Promise<void> {
    if (!this.sessionManager || !this.session) return;
    await this.sessionManager.hangup(this.session);
  }

  toggleMute(): void {
    if (!this.sessionManager || !this.session) return;
    if (this.state.muted) this.sessionManager.unmute(this.session);
    else this.sessionManager.mute(this.session);
    this.setState({ muted: !this.state.muted });
  }

  private async handleHangup(): Promise<void> {
    const durationSeconds = this.callStartedAt ? Math.round((Date.now() - this.callStartedAt) / 1000) : 0;
    const status = this.wasAnswered ? "ANSWERED" : this.state.callState === "ringing-incoming" ? "MISSED" : "NO_ANSWER";
    if (this.callLogId) {
      await endCall(this.callLogId, { status, durationSeconds }).catch(() => {});
    }
    this.session = null;
    this.callLogId = null;
    this.callStartedAt = null;
    this.wasAnswered = false;
    this.setState({ callState: "idle", remoteNumber: null, remoteName: null, muted: false });
  }
}

export const voipEngine = new VoipEngine();
