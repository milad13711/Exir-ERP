import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { AGENTS_MODULE_CODE, registrySlug } from './agent-constants.js';
import { normalizeIranMobile } from './agent-phone.js';

export type ReminderKind = 'D30' | 'D7';
const DAY = 86_400_000;
/** سقف‌ها: هر نماینده حداکثر یک پیامک برای هر نوع در هر اجرا؛ هر پیامک حداکثر ۸ مشتری؛ هر اجرا حداکثر ۳۰۰ پیامک. */
export const MAX_NAMES_PER_SMS = 8;
export const MAX_SMS_PER_RUN = 300;

/** ≤۷ روز → D7؛ ۸ تا ۳۰ روز → D30؛ گذشته یا دورتر از ۳۰ روز → null. */
export function classifyReminder(nextRenewalAt: Date, now: Date): ReminderKind | null {
  const days = Math.ceil((nextRenewalAt.getTime() - now.getTime()) / DAY);
  if (days <= 0) return null;
  if (days <= 7) return 'D7';
  if (days <= 30) return 'D30';
  return null;
}

export function buildReminderMessage(kind: ReminderKind, items: Array<{ name: string; planName: string | null }>, extra: number, url?: string): string {
  const head = kind === 'D7' ? 'یادآوری فوری تمدید (کمتر از ۷ روز)' : 'یادآوری تمدید (تا ۳۰ روز آینده)';
  const names = items.map((i) => (i.planName ? `${i.name} (${i.planName})` : i.name)).join('، ');
  return `${head}: ${names}${extra > 0 ? ` و ${extra} مشتری دیگر` : ''}${url ? `\n${url}` : ''}`;
}

/** هر روز ۱۰ صبح تهران: به نماینده‌ی هر مشتریِ نزدیک به پایان دوره پیامک تمدید می‌فرستد (ایدمپوتنت با AgentRenewalReminder). */
@Injectable()
export class AgentRenewalReminderService {
  private readonly logger = new Logger('AgentRenewalReminder');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sms: TenantSmsService,
  ) {}

  @Cron('0 10 * * *', { timeZone: 'Asia/Tehran' })
  async sweep(): Promise<void> {
    try {
      const tenant = await this.controlDb.tenant.findUnique({ where: { slug: registrySlug() } });
      if (!tenant || tenant.status !== 'ACTIVE') return;
      const installed = await this.controlDb.tenantModule.findFirst({ where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: AGENTS_MODULE_CODE } } });
      if (!installed) return;
      const res = await this.runFor({ tenantId: tenant.id, tenantDb: this.tenantPrisma.forTenant(tenant) });
      this.logger.log(`renewal reminders: sent=${res.sent} skipped=${res.skipped}`);
    } catch (e) {
      this.logger.error(`renewal reminder sweep failed: ${(e as Error).message}`);
    }
  }

  /** قابل‌تست: tenantDb و sms تزریق‌پذیر. */
  async runFor(t: { tenantId: string; tenantDb: TenantPrismaClient }, now = new Date()): Promise<{ sent: number; skipped: number }> {
    const db = t.tenantDb;
    const customers = await db.agentCustomer.findMany({
      where: { status: 'ACTIVE', nextRenewalAt: { gt: now, lte: new Date(now.getTime() + 30 * DAY) }, membership: { status: 'ACTIVE' } },
      select: {
        id: true, name: true, planName: true, nextRenewalAt: true,
        membership: { select: { resellerProfileId: true, resellerProfile: { select: { contact: { select: { phone: true } } } } } },
      },
      orderBy: { nextRenewalAt: 'asc' },
      take: 5000,
    });
    // دسته‌بندی به‌ازای (نماینده، نوع)
    const groups = new Map<string, { phone: string; kind: ReminderKind; rows: typeof customers }>();
    for (const c of customers) {
      const kind = classifyReminder(c.nextRenewalAt!, now);
      const phone = normalizeIranMobile(c.membership.resellerProfile.contact.phone);
      if (!kind || !phone) continue;
      const key = `${c.membership.resellerProfileId}:${kind}`;
      const g = groups.get(key) ?? { phone, kind, rows: [] };
      g.rows.push(c);
      groups.set(key, g);
    }
    let sent = 0;
    let skipped = 0;
    const web = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    for (const g of groups.values()) {
      if (sent >= MAX_SMS_PER_RUN) {
        skipped += g.rows.length;
        continue;
      }
      // ادعای ایدمپوتنت: ردیف یکتا به‌ازای (مشتری، نوع، پایان دوره)؛ قبلاً ارسال‌شده‌ها رد می‌شوند
      const claimed: Array<{ id: string; name: string; planName: string | null }> = [];
      const claimIds: string[] = [];
      for (const c of g.rows) {
        try {
          const row = await db.agentRenewalReminder.create({ data: { customerId: c.id, kind: g.kind, periodEnd: c.nextRenewalAt! } });
          claimIds.push(row.id);
          claimed.push({ id: c.id, name: c.name, planName: c.planName });
        } catch (e) {
          if ((e as { code?: string }).code !== 'P2002') throw e;
          skipped++;
        }
      }
      if (claimed.length === 0) continue;
      const shown = claimed.slice(0, MAX_NAMES_PER_SMS);
      const msg = buildReminderMessage(g.kind, shown, claimed.length - shown.length, web ? `${web}/agents` : undefined);
      const res = await this.sms.sendSms({ tenantId: t.tenantId, tenantDb: db }, g.phone, msg, { purpose: 'agent-renewal-reminder', moduleCode: AGENTS_MODULE_CODE, actorType: 'SYSTEM' as never });
      if (res.success) sent++;
      else {
        // ارسال شکست‌خورده: ادعاها آزاد می‌شود تا اجرای فردا دوباره تلاش کند
        await db.agentRenewalReminder.deleteMany({ where: { id: { in: claimIds } } });
        skipped += claimed.length;
      }
    }
    return { sent, skipped };
  }
}
