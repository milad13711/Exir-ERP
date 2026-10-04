import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { AudienceService } from './audience.service.js';
import { CampaignImageService, type TemplateCode } from './campaign-image.service.js';
import type { CreateCampaignDto } from './dto/create-campaign.dto.js';
import type { UpdateCampaignDto } from './dto/update-campaign.dto.js';
import type { AudienceFilterDto } from './dto/audience-filter.dto.js';

const ATTRIBUTION_WINDOW_DAYS = 7;
const CAMPAIGN_INCLUDE = { recipients: { include: { contact: { select: { id: true, name: true, phone: true } } } } } as const;

@Injectable()
export class CampaignsService {
  constructor(
    private readonly sms: TenantSmsService,
    private readonly audience: AudienceService,
    private readonly image: CampaignImageService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  async previewAudience(ctx: TenantRequestContext, filter: AudienceFilterDto) {
    const contacts = await this.audience.resolve(ctx, filter);
    return { count: contacts.length, sample: contacts.slice(0, 20) };
  }

  async create(ctx: TenantRequestContext, dto: CreateCampaignDto, userId: string | undefined) {
    if (dto.channel === 'INSTAGRAM_TEMPLATE' && !dto.templateCode) {
      throw new BadRequestException('برای کمپین تمپلیت اینستاگرام، انتخاب قالب الزامی است');
    }
    if ((dto.channel === 'SMS' || dto.channel === 'BALE' || dto.channel === 'WHATSAPP') && !dto.messageText?.trim()) {
      throw new BadRequestException('متن پیام الزامی است');
    }

    const isMessagingChannel = dto.channel !== 'INSTAGRAM_TEMPLATE';
    const audienceContacts = isMessagingChannel ? await this.audience.resolve(ctx, dto.audienceFilter) : [];

    const campaign = await ctx.tenantDb.marketingCampaign.create({
      data: {
        name: dto.name,
        channel: dto.channel,
        messageText: dto.messageText,
        templateCode: dto.templateCode,
        templateTitle: dto.templateTitle,
        templateCta: dto.templateCta,
        audienceFilter: (dto.audienceFilter ?? {}) as never,
        createdByUserId: userId,
        recipientCount: audienceContacts.length,
        recipients: isMessagingChannel
          ? { create: audienceContacts.map((c) => ({ contactId: c.id, phone: c.phone })) }
          : undefined,
      },
      include: CAMPAIGN_INCLUDE,
    });
    return campaign;
  }

  /** فقط پیش‌نویس قابل ویرایش است — اگر فیلتر مخاطب عوض شود، گیرندگان قبلی حذف و از نو با فیلتر جدید محاسبه می‌شوند. */
  async update(ctx: TenantRequestContext, id: string, dto: UpdateCampaignDto) {
    const campaign = await ctx.tenantDb.marketingCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('کمپین یافت نشد');
    if (campaign.status !== 'DRAFT') throw new BadRequestException('فقط کمپین پیش‌نویس قابل ویرایش است');

    const isMessagingChannel = campaign.channel !== 'INSTAGRAM_TEMPLATE';
    const filterChanged = dto.audienceFilter !== undefined;
    const audienceContacts = filterChanged && isMessagingChannel ? await this.audience.resolve(ctx, dto.audienceFilter!) : null;

    if (audienceContacts) {
      await ctx.tenantDb.marketingCampaignRecipient.deleteMany({ where: { campaignId: id } });
    }

    return ctx.tenantDb.marketingCampaign.update({
      where: { id },
      data: {
        name: dto.name,
        messageText: dto.messageText,
        templateCode: dto.templateCode,
        templateTitle: dto.templateTitle,
        templateCta: dto.templateCta,
        audienceFilter: dto.audienceFilter !== undefined ? (dto.audienceFilter as never) : undefined,
        recipientCount: audienceContacts ? audienceContacts.length : undefined,
        recipients: audienceContacts ? { create: audienceContacts.map((c) => ({ contactId: c.id, phone: c.phone })) } : undefined,
      },
      include: CAMPAIGN_INCLUDE,
    });
  }

  async delete(ctx: TenantRequestContext, id: string) {
    const campaign = await ctx.tenantDb.marketingCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('کمپین یافت نشد');
    if (campaign.status !== 'DRAFT') throw new BadRequestException('فقط کمپین پیش‌نویس قابل حذف است');
    await ctx.tenantDb.marketingCampaign.delete({ where: { id } });
    return { ok: true };
  }

  async list(ctx: TenantRequestContext, scope: Record<string, unknown> = {}) {
    return ctx.tenantDb.marketingCampaign.findMany({ where: scope, orderBy: { createdAt: 'desc' } });
  }

  async detail(ctx: TenantRequestContext, id: string, scope: Record<string, unknown> = {}) {
    const campaign = await ctx.tenantDb.marketingCampaign.findFirst({ where: { id, ...scope }, include: CAMPAIGN_INCLUDE });
    if (!campaign) throw new NotFoundException('کمپین یافت نشد');

    // عملکرد کمپین: چند نفر از گیرندگان طی بازه‌ی زیر بعد از ارسال خرید ثبت کردند —
    // تخمین، نه attribution رسمی. برای کمپین‌های ارسال‌نشده صفر می‌ماند.
    if (campaign.sentAt && campaign.recipients.length > 0) {
      const windowEnd = new Date(campaign.sentAt.getTime() + ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const contactIds = campaign.recipients.map((r) => r.contactId);
      const orders = await ctx.tenantDb.storeOrder.findMany({
        where: { contactId: { in: contactIds }, createdAt: { gte: campaign.sentAt, lte: windowEnd } },
        select: { subtotal: true },
      });
      const attributedOrderCount = orders.length;
      const attributedRevenue = orders.reduce((sum, o) => sum + o.subtotal, 0);
      if (attributedOrderCount !== campaign.attributedOrderCount || attributedRevenue !== campaign.attributedRevenue) {
        await ctx.tenantDb.marketingCampaign.update({
          where: { id },
          data: { attributedOrderCount, attributedRevenue },
        });
        campaign.attributedOrderCount = attributedOrderCount;
        campaign.attributedRevenue = attributedRevenue;
      }
    }

    return campaign;
  }

  async send(ctx: TenantRequestContext, id: string) {
    const campaign = await ctx.tenantDb.marketingCampaign.findUnique({ where: { id }, include: CAMPAIGN_INCLUDE });
    if (!campaign) throw new NotFoundException('کمپین یافت نشد');
    if (campaign.status !== 'DRAFT') throw new BadRequestException('این کمپین قبلاً ارسال شده است');
    if (campaign.channel === 'INSTAGRAM_TEMPLATE') {
      throw new BadRequestException('کمپین تمپلیت اینستاگرام ارسال ندارد — تصویر را از بخش پیش‌نمایش دانلود کنید');
    }
    if (campaign.channel === 'BALE' || campaign.channel === 'WHATSAPP') {
      throw new BadRequestException('این کانال هنوز به ارسال واقعی متصل نشده — فعلاً فقط پیامک فعال است');
    }
    if ((await this.sms.getConnection(ctx.tenantDb)).mode === 'NONE') {
      throw new BadRequestException('پنل پیامکی متصل نیست؛ از تنظیمات ← پنل پیامکی آن را متصل کنید');
    }

    await ctx.tenantDb.marketingCampaign.update({ where: { id }, data: { status: 'SENDING' } });

    let sentCount = 0;
    let failedCount = 0;
    for (const recipient of campaign.recipients) {
      if (!recipient.phone) {
        await ctx.tenantDb.marketingCampaignRecipient.update({
          where: { id: recipient.id },
          data: { status: 'SKIPPED', error: 'بدون شماره موبایل' },
        });
        continue;
      }
      const result = await this.sms.sendSms(ctx, recipient.phone, campaign.messageText ?? '');
      if (result.success) {
        sentCount++;
        await ctx.tenantDb.marketingCampaignRecipient.update({
          where: { id: recipient.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
      } else {
        failedCount++;
        await ctx.tenantDb.marketingCampaignRecipient.update({
          where: { id: recipient.id },
          data: { status: 'FAILED', error: result.error },
        });
      }
    }

    return ctx.tenantDb.marketingCampaign.update({
      where: { id },
      data: { status: sentCount > 0 ? 'SENT' : 'FAILED', sentAt: new Date(), sentCount, failedCount },
      include: CAMPAIGN_INCLUDE,
    });
  }

  async renderTemplateImage(ctx: TenantRequestContext, id: string): Promise<Buffer> {
    const campaign = await ctx.tenantDb.marketingCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('کمپین یافت نشد');
    if (campaign.channel !== 'INSTAGRAM_TEMPLATE' || !campaign.templateCode) {
      throw new BadRequestException('این کمپین از نوع تمپلیت اینستاگرام نیست');
    }
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId } });
    const png = await this.image.render(campaign.templateCode as TemplateCode, {
      storeName: tenant?.name ?? '',
      title: campaign.templateTitle ?? campaign.name,
      body: campaign.messageText ?? '',
      cta: campaign.templateCta ?? '',
      brandColor: tenant?.themeColor ?? undefined,
    });
    if (campaign.status === 'DRAFT') {
      await ctx.tenantDb.marketingCampaign.update({ where: { id }, data: { status: 'SENT', sentAt: new Date() } });
    }
    return png;
  }
}
