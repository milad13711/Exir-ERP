import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { CreateLetterheadDto, UpdateLetterheadDto } from './dto/letterhead.dto.js';
import { defaultLayout, validateLayout } from './letterhead-layout.js';
import type { LetterheadLayout } from './render-input.js';
import { MAX_LETTER_IMAGE_BYTES, safeLetterImage } from './pdf/sanitize-letter-html.js';

/**
 * تصویر سربرگ: فقط PNG/JPEG/WebP (WebP چون فشرده‌ساز مرورگر معمولاً همین خروجی را می‌دهد)، سقف ۳ مگابایت، magic-bytes بررسی می‌شود.
 * PDF پذیرفته نمی‌شود (ساده‌ترین حالت امن): کاربر باید یک صفحه‌ی سربرگ را به تصویر تبدیل کند (UI راهنمایی می‌دهد).
 */
export function validateBackgroundImage(uri: string): string {
  if (/^data:application\/pdf/i.test(uri)) throw new BadRequestException('فایل PDF پذیرفته نمی‌شود؛ صفحه‌ی سربرگ را به‌صورت تصویر (PNG، JPEG یا WebP) بارگذاری کنید');
  const ok = safeLetterImage(uri, MAX_LETTER_IMAGE_BYTES);
  if (!ok) throw new BadRequestException('فقط تصویر PNG، JPEG یا WebP معتبر تا ۳ مگابایت برای سربرگ پذیرفته می‌شود');
  return ok;
}

type Row = Awaited<ReturnType<TenantRequestContext['tenantDb']['corrLetterhead']['findFirstOrThrow']>>;
export type LetterheadView = Omit<Row, 'backgroundImage' | 'layoutJson'> & { layout: LetterheadLayout; hasImage: boolean; backgroundImage?: string | null };

function view(r: Row, withImage: boolean): LetterheadView {
  const { backgroundImage, layoutJson, ...rest } = r;
  return { ...rest, layout: layoutJson as unknown as LetterheadLayout, hasImage: !!backgroundImage, ...(withImage ? { backgroundImage } : {}) };
}

@Injectable()
export class LetterheadService {
  async list(ctx: TenantRequestContext): Promise<LetterheadView[]> {
    const rows = await ctx.tenantDb.corrLetterhead.findMany({
      select: { id: true, name: true, isDefault: true, isActive: true, pageSize: true, orientation: true, layoutJson: true, departmentId: true, createdBy: true, createdAt: true, updatedAt: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    const withImg = new Set((await ctx.tenantDb.corrLetterhead.findMany({ where: { backgroundImage: { not: null } }, select: { id: true } })).map((r) => r.id));
    return rows.map(({ layoutJson, ...r }) => ({ ...r, backgroundImage: null, layout: layoutJson as unknown as LetterheadLayout, hasImage: withImg.has(r.id) }));
  }

  async get(ctx: TenantRequestContext, id: string, withImage = true): Promise<LetterheadView> {
    const r = await ctx.tenantDb.corrLetterhead.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('سربرگ یافت نشد');
    return view(r, withImage);
  }

  async create(ctx: TenantRequestContext, dto: CreateLetterheadDto): Promise<LetterheadView> {
    const pageSize = dto.pageSize ?? 'A4';
    const orientation = dto.orientation ?? 'portrait';
    const layout = dto.layout ? validateLayout(dto.layout, pageSize, orientation) : defaultLayout(pageSize, orientation);
    const image = dto.backgroundImage ? validateBackgroundImage(dto.backgroundImage) : null;
    const createdBy = await resolveTenantUserId(ctx);
    const departmentId = dto.departmentId || null;
    const created = await ctx.tenantDb.$transaction(async (tx) => {
      const makeDefault = dto.isDefault === true || (await tx.corrLetterhead.count({ where: { departmentId, isDefault: true } })) === 0;
      if (makeDefault) await tx.corrLetterhead.updateMany({ where: { departmentId, isDefault: true }, data: { isDefault: false } });
      return tx.corrLetterhead.create({
        data: { name: dto.name.trim(), isDefault: makeDefault, isActive: dto.isActive ?? true, backgroundImage: image, pageSize, orientation, layoutJson: layout as unknown as Prisma.InputJsonValue, departmentId, createdBy },
      });
    });
    return view(created, false);
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateLetterheadDto): Promise<LetterheadView> {
    const cur = await ctx.tenantDb.corrLetterhead.findUnique({ where: { id }, select: { pageSize: true, orientation: true, layoutJson: true } });
    if (!cur) throw new NotFoundException('سربرگ یافت نشد');
    const pageSize = (dto.pageSize ?? cur.pageSize) as 'A4' | 'A5';
    const orientation = (dto.orientation ?? cur.orientation) as 'portrait' | 'landscape';
    const data: Prisma.CorrLetterheadUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId || null;
    if (dto.backgroundImage !== undefined) data.backgroundImage = dto.backgroundImage ? validateBackgroundImage(dto.backgroundImage) : null;
    const sizeChanged = pageSize !== cur.pageSize || orientation !== cur.orientation;
    if (dto.layout || sizeChanged) {
      // تغییر اندازه/جهت بدون چیدمان جدید: چیدمان قبلی معتبر نیست → چیدمان پیش‌فرضِ آن اندازه
      const layout = dto.layout ? validateLayout(dto.layout, pageSize, orientation) : defaultLayout(pageSize, orientation);
      data.layoutJson = layout as unknown as Prisma.InputJsonValue;
      data.pageSize = pageSize;
      data.orientation = orientation;
    }
    if (data.isActive === false) {
      const row = await ctx.tenantDb.corrLetterhead.findUnique({ where: { id }, select: { isDefault: true } });
      if (row?.isDefault) throw new BadRequestException('سربرگ پیش‌فرض را نمی‌توان غیرفعال کرد؛ ابتدا سربرگ دیگری را پیش‌فرض کنید');
    }
    const r = await ctx.tenantDb.corrLetterhead.update({ where: { id }, data });
    return view(r, false);
  }

  async setDefault(ctx: TenantRequestContext, id: string): Promise<{ success: true }> {
    const row = await ctx.tenantDb.corrLetterhead.findUnique({ where: { id }, select: { departmentId: true, isActive: true } });
    if (!row) throw new NotFoundException('سربرگ یافت نشد');
    if (!row.isActive) throw new BadRequestException('سربرگ غیرفعال را نمی‌توان پیش‌فرض کرد');
    await ctx.tenantDb.$transaction([
      ctx.tenantDb.corrLetterhead.updateMany({ where: { departmentId: row.departmentId, isDefault: true }, data: { isDefault: false } }),
      ctx.tenantDb.corrLetterhead.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return { success: true };
  }

  async duplicate(ctx: TenantRequestContext, id: string): Promise<LetterheadView> {
    const r = await ctx.tenantDb.corrLetterhead.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('سربرگ یافت نشد');
    const createdBy = await resolveTenantUserId(ctx);
    const copy = await ctx.tenantDb.corrLetterhead.create({
      data: { name: `${r.name} (کپی)`.slice(0, 120), isDefault: false, isActive: true, backgroundImage: r.backgroundImage, pageSize: r.pageSize, orientation: r.orientation, layoutJson: r.layoutJson as Prisma.InputJsonValue, departmentId: r.departmentId, createdBy },
    });
    return view(copy, false);
  }

  async remove(ctx: TenantRequestContext, id: string): Promise<{ success: true }> {
    const r = await ctx.tenantDb.corrLetterhead.findUnique({ where: { id }, select: { isDefault: true } });
    if (!r) throw new NotFoundException('سربرگ یافت نشد');
    if (r.isDefault && (await ctx.tenantDb.corrLetterhead.count()) > 1) throw new BadRequestException('سربرگ پیش‌فرض را نمی‌توان حذف کرد؛ ابتدا سربرگ دیگری را پیش‌فرض کنید');
    await ctx.tenantDb.corrLetterhead.delete({ where: { id } });
    return { success: true };
  }

  /**
   * سربرگ برای رندر (مصرف A1/LetterPdfService): id صریح → سربرگ آن؛ وگرنه پیش‌فرض واحد → پیش‌فرض سازمان → چیدمان داخلی بدون تصویر.
   * همیشه چیدمان را دوباره اعتبارسنجی می‌کند (داده‌ی DB را قابل‌اعتماد فرض نمی‌کند).
   */
  async resolveForRender(ctx: TenantRequestContext, opts: { letterheadId?: string | null; departmentId?: string | null } = {}): Promise<{ id: string | null; imageDataUri: string | null; layout: LetterheadLayout }> {
    let r: Row | null = null;
    if (opts.letterheadId) {
      r = await ctx.tenantDb.corrLetterhead.findUnique({ where: { id: opts.letterheadId } });
      if (!r) throw new NotFoundException('سربرگ یافت نشد');
    } else {
      if (opts.departmentId) r = await ctx.tenantDb.corrLetterhead.findFirst({ where: { departmentId: opts.departmentId, isActive: true, isDefault: true } });
      r ??= await ctx.tenantDb.corrLetterhead.findFirst({ where: { departmentId: null, isActive: true, isDefault: true } });
      r ??= await ctx.tenantDb.corrLetterhead.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    }
    if (!r) return { id: null, imageDataUri: null, layout: defaultLayout() };
    const layout = validateLayout(r.layoutJson, r.pageSize as 'A4' | 'A5', r.orientation as 'portrait' | 'landscape');
    return { id: r.id, imageDataUri: r.backgroundImage, layout };
  }
}
