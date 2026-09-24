import { Body, Controller, ForbiddenException, Headers, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { VoipProviderRegistryService } from './voip-provider-registry.service.js';
import { VoipGateway } from './voip.gateway.js';
import { CallLogService } from './call-log.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { phonesMatch } from './phone-match.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { CallEndedEvent, IncomingCallEvent } from './types.js';

/**
 * Where a tenant's PBX actually points its webhook. No JWT here — a PBX
 * can't carry our Bearer tokens — auth is a per-tenant secret in the URL,
 * generated when the provider is configured (see VoipController.saveConfig)
 * and compared with a timing-safe-ish plain equality (short-lived, low-
 * value secret; not worth the extra dependency for a real HMAC compare).
 */
@Controller('public/voip')
export class VoipWebhookController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly registry: VoipProviderRegistryService,
    private readonly gateway: VoipGateway,
    private readonly automation: AutomationEngineService,
    private readonly callLog: CallLogService,
  ) {}

  @Post('webhook/:slug/:providerCode')
  async receive(
    @Param('slug') slug: string,
    @Param('providerCode') providerCode: string,
    @Query('secret') secret: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new NotFoundException('تننت یافت نشد');
    const tenantDb = this.tenantPrisma.forTenant(tenant);

    const providerConfig = await tenantDb.voipProviderConfig.findFirst({ where: { providerCode, isActive: true } });
    if (!providerConfig || !secret || providerConfig.webhookSecret !== secret) {
      throw new ForbiddenException('وب‌هوک نامعتبر است');
    }

    const adapter = this.registry.get(providerCode);
    const event = adapter?.parseWebhook(body);
    if (event) return this.handleIncoming(tenant, tenantDb, event);

    const endedEvent = adapter?.parseCallEndedWebhook?.(body);
    if (endedEvent) return this.handleEnded(tenantDb, endedEvent);

    return { received: true }; // not an event we act on — 200 so the PBX doesn't retry forever
  }

  /**
   * وب‌هوک نواتل: در پنل نواتل فقط «آدرس پایه» وارد می‌شود و خود نواتل مسیرهای
   * /api/navatel/Voip/Call (زنگ خوردن)، /Answer (پاسخ) و /Endcall (پایان) را به آن اضافه می‌کند و
   * کلید را در هدر ApiKey می‌فرستد — این کلید همان webhookSecret تنظیمات VoIP است.
   */
  @Post('navatel/:slug/api/navatel/Voip/:action')
  async receiveNavatel(
    @Param('slug') slug: string,
    @Param('action') action: string,
    @Headers('apikey') apiKey: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new NotFoundException('تننت یافت نشد');
    const tenantDb = this.tenantPrisma.forTenant(tenant);
    const providerConfig = await tenantDb.voipProviderConfig.findFirst({ where: { providerCode: 'novatel', isActive: true } });
    if (!providerConfig || !apiKey || providerConfig.webhookSecret !== apiKey) throw new ForbiddenException('وب‌هوک نامعتبر است');

    const adapter = this.registry.get('novatel');
    const kind = action.toLowerCase();
    if (kind === 'call') {
      const event = adapter?.parseWebhook(body);
      return event ? this.handleIncoming(tenant, tenantDb, event) : { received: true };
    }
    if (kind === 'answer') {
      const id = body && typeof body === 'object' ? (body as Record<string, unknown>).callID : undefined;
      if (id != null) await tenantDb.callLog.updateMany({ where: { providerCallId: String(id), status: 'RINGING' }, data: { status: 'ANSWERED' } });
      return { received: true };
    }
    const ended = adapter?.parseCallEndedWebhook?.(body);
    return ended ? this.handleEnded(tenantDb, ended) : { received: true };
  }

  private async handleIncoming(tenant: { id: string; slug: string }, tenantDb: TenantPrismaClient, event: IncomingCallEvent) {
    // event.toExtension ممکن است داخلی webhook قدیمی (extension) یا همان
    // نام‌کاربری SIP ثبت‌شده‌ی اتصال مستقیم تلفن IP (sipUsername) باشد —
    // رابط کاربری فعلی فقط دومی را ست می‌کند.
    const extension = await tenantDb.voipExtension.findFirst({
      where: { OR: [{ extension: event.toExtension }, { sipUsername: event.toExtension }] },
    });
    if (!extension) return { received: true }; // no one in the ERP owns this extension

    const contacts = await tenantDb.crmContact.findMany({ where: { phone: { not: null } }, select: { id: true, name: true, phone: true } });
    const contact = contacts.find((c) => c.phone && phonesMatch(c.phone, event.fromNumber));

    this.gateway.notifyIncomingCall(extension.userId, {
      fromNumber: event.fromNumber,
      contactId: contact?.id ?? null,
      contactName: contact?.name ?? null,
      callId: event.callId,
    });

    await this.callLog.recordIncoming(tenantDb, {
      fromNumber: event.fromNumber,
      toExtension: event.toExtension,
      providerCallId: event.callId,
      userId: extension.userId,
      contactId: contact?.id ?? null,
      contactName: contact?.name ?? null,
    });

    const ctx = { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
    await this.automation.emit(ctx, 'voip.call.incoming', {
      fromNumber: event.fromNumber,
      contactId: contact?.id ?? null,
      contactName: contact?.name ?? null,
      calleeUserId: extension.userId,
    });

    return { received: true };
  }

  private async handleEnded(tenantDb: TenantPrismaClient, endedEvent: CallEndedEvent) {
    const result = await this.callLog.recordEnded(tenantDb, endedEvent);
    if (result?.userId) {
      this.gateway.notifyCallEnded(result.userId, { callId: endedEvent.callId, status: result.status, durationSeconds: result.durationSeconds });
    }
    return { received: true };
  }
}
