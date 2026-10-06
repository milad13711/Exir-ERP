import { randomUUID } from 'node:crypto';
import type { MoodianClient, MoodianFiscalInfo, MoodianInquiryItem, MoodianSendResult, MoodianServerInfo, SendPermit, ClientSettingsView } from './moodian-client.js';
import { assertSendAllowed } from './send-guard.js';

type Outcome = { send?: { errorCode: string; errorDetail: string }; inquiry?: 'SUCCESS' | 'FAILED' | 'PENDING'; taxResult?: string; sendThrows?: Error };

/** کلاینت درون‌حافظه‌ای برای تست — هیچ شبکه‌ای ندارد. همان گارد ارسال را اعمال می‌کند. */
export class FakeMoodianClient implements MoodianClient {
  readonly sent: Array<{ uid: string; retry: boolean; invoice: unknown }> = [];
  private readonly byUid = new Map<string, { ref: string; inquiry: 'SUCCESS' | 'FAILED' | 'PENDING'; taxResult: string }>();
  private readonly outcomes = new Map<string, Outcome>();
  defaultInquiry: 'SUCCESS' | 'FAILED' | 'PENDING' = 'SUCCESS';
  serverInfo: MoodianServerInfo = { serverTime: Date.now(), publicKeys: [] };

  constructor(private readonly settings: ClientSettingsView) {}

  /** نتیجه‌ی برنامه‌ریزی‌شده برای یک uid. */
  plan(uid: string, outcome: Outcome): this {
    this.outcomes.set(uid, outcome);
    return this;
  }

  async getServerInformation(): Promise<MoodianServerInfo> {
    return this.serverInfo;
  }

  async getFiscalInformation(): Promise<MoodianFiscalInfo> {
    return { fiscalStatus: 'ACTIVE', economicCode: '12345678911234' };
  }

  async sendInvoice(permit: SendPermit): Promise<MoodianSendResult> {
    assertSendAllowed(this.settings, permit);
    const plan = this.outcomes.get(permit.uid);
    if (plan?.sendThrows) throw plan.sendThrows;
    this.sent.push({ uid: permit.uid, retry: permit.retry, invoice: permit.invoice });
    if (plan?.send) return { uid: permit.uid, referenceNumber: null, errorCode: plan.send.errorCode, errorDetail: plan.send.errorDetail };
    const ref = randomUUID();
    this.byUid.set(permit.uid, { ref, inquiry: plan?.inquiry ?? this.defaultInquiry, taxResult: plan?.taxResult ?? 'SUCCESS' });
    return { uid: permit.uid, referenceNumber: ref, errorCode: null, errorDetail: null };
  }

  private item(uid: string): MoodianInquiryItem | null {
    const r = this.byUid.get(uid);
    if (!r) return null;
    return {
      uid,
      referenceNumber: r.ref,
      status: r.inquiry,
      data: r.inquiry === 'PENDING' ? null : { confirmationReferenceId: r.inquiry === 'SUCCESS' ? randomUUID() : null, taxResult: r.taxResult },
      packetType: r.inquiry === 'SUCCESS' ? 'RECEIVE_INVOICE_CONFIRM' : r.inquiry === 'FAILED' ? 'ERROR' : null,
      fiscalId: this.settings.fiscalId,
    };
  }

  async inquiryByUid(uids: string[]): Promise<MoodianInquiryItem[]> {
    return uids.map((u) => this.item(u)).filter((x): x is MoodianInquiryItem => x !== null);
  }

  async inquiryByReferenceNumber(refs: string[]): Promise<MoodianInquiryItem[]> {
    const out: MoodianInquiryItem[] = [];
    for (const [uid, r] of this.byUid) if (refs.includes(r.ref)) out.push(this.item(uid)!);
    return out;
  }
}
