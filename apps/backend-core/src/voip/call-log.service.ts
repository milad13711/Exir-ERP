import { Injectable } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient, CallStatus } from '../../generated/tenant-client/index.js';
import type { CallEndedEvent } from './types.js';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m} دقیقه و ${s} ثانیه`;
}

/**
 * تاریخچه‌ی تماس تننت (CallLog) + یادداشت خودکار روی پروفایل مخاطب
 * (CrmActivity، از همان تایم‌لاین موجود مخاطب استفاده می‌کند — بدون هیچ
 * UI جدید روی صفحه‌ی مخاطب). فراخوانی‌شده هم از وب‌هوک تماس ورودی/پایان
 * و هم از originate (تماس خروجی)، تا هر دو مسیر دقیقاً یک شکل رفتار کنند.
 */
@Injectable()
export class CallLogService {
  async recordIncoming(
    tenantDb: TenantPrismaClient,
    params: { fromNumber: string; toExtension: string; providerCallId: string; userId: string; contactId: string | null; contactName: string | null },
  ) {
    const activity = params.contactId
      ? await tenantDb.crmActivity.create({
          data: { type: 'CALL', contactId: params.contactId, userId: params.userId, body: `تماس ورودی از ${params.contactName ?? params.fromNumber}` },
        })
      : null;

    return tenantDb.callLog.create({
      data: {
        providerCallId: params.providerCallId || undefined,
        direction: 'INBOUND',
        status: 'RINGING',
        fromNumber: params.fromNumber,
        toNumber: params.toExtension,
        contactId: params.contactId,
        userId: params.userId,
        crmActivityId: activity?.id,
      },
    });
  }

  async recordOutbound(
    tenantDb: TenantPrismaClient,
    params: { fromExtension: string; toNumber: string; providerCallId?: string; userId: string; contactId: string | null; contactName: string | null },
  ) {
    const activity = params.contactId
      ? await tenantDb.crmActivity.create({
          data: { type: 'CALL', contactId: params.contactId, userId: params.userId, body: `تماس خروجی به ${params.contactName ?? params.toNumber}` },
        })
      : null;

    return tenantDb.callLog.create({
      data: {
        providerCallId: params.providerCallId || undefined,
        direction: 'OUTBOUND',
        status: 'RINGING',
        fromNumber: params.fromExtension,
        toNumber: params.toNumber,
        contactId: params.contactId,
        userId: params.userId,
        crmActivityId: activity?.id,
      },
    });
  }

  /** با providerCallId ردیف را پیدا و تکمیل می‌کند — اگر ارائه‌دهنده هرگز رویداد پایان تماس نفرستد، ردیف روی «در حال تماس» باقی می‌ماند (کمبود شناخته‌شده، نه باگ). */
  async recordEnded(tenantDb: TenantPrismaClient, event: CallEndedEvent) {
    const log = await tenantDb.callLog.findUnique({ where: { providerCallId: event.callId }, include: { activity: true } });
    if (!log) return null;
    return this.applyEnded(tenantDb, log, event);
  }

  /** همان recordEnded، ولی با شناسه‌ی خودِ CallLog — برای مسیر تماس مرورگری (SIP/WebRTC) که خودش همان لحظه شناسه‌ی ردیف را در اختیار دارد، بدون نیاز به providerCallId. */
  async endById(tenantDb: TenantPrismaClient, id: string, event: Omit<CallEndedEvent, 'callId'>) {
    const log = await tenantDb.callLog.findUnique({ where: { id }, include: { activity: true } });
    if (!log) return null;
    return this.applyEnded(tenantDb, log, event);
  }

  private async applyEnded(
    tenantDb: TenantPrismaClient,
    log: { id: string; status: CallStatus; userId: string | null; durationSeconds: number | null; activity: { id: string; body: string | null } | null },
    event: Omit<CallEndedEvent, 'callId'>,
  ) {
    const status = event.status ?? (log.status === 'RINGING' ? 'ANSWERED' : log.status);
    await tenantDb.callLog.update({
      where: { id: log.id },
      data: {
        status,
        endedAt: new Date(),
        durationSeconds: event.durationSeconds ?? undefined,
        recordingUrl: event.recordingUrl ?? undefined,
      },
    });

    if (log.activity) {
      const parts = [log.activity.body ?? ''];
      if (event.durationSeconds != null) parts.push(`مدت تماس: ${formatDuration(event.durationSeconds)}`);
      if (event.recordingUrl) parts.push('ضبط مکالمه موجود است.');
      await tenantDb.crmActivity.update({ where: { id: log.activity.id }, data: { body: parts.filter(Boolean).join('\n') } });
    }

    return { userId: log.userId, status, durationSeconds: event.durationSeconds ?? log.durationSeconds ?? null };
  }
}
