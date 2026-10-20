import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import type { CategoryDto, FolderDto, NumberingSchemeDto, UpdateCategoryDto, UpdateNumberingSchemeDto } from './dto/correspondence.dto.js';
import { CorrespondenceNumberingService } from './correspondence-numbering.service.js';
import { isLetterType, type LetterType } from './correspondence.constants.js';
import { validatePattern } from './numbering.js';

/** دسته‌ها، طرح‌های شماره‌گذاری و پوشه‌های بایگانی. نوشتن فقط مدیر (کنترلر بررسی می‌کند). */
@Injectable()
export class CorrespondenceSettingsService {
  constructor(private readonly numbering: CorrespondenceNumberingService) {}

  // ── دسته‌ها ────────────────────────────────────────────────────────────
  listCategories(ctx: TenantRequestContext) {
    return ctx.tenantDb.corrLetterCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  /** شناسه‌ی دسته + همه‌ی نوادگانش (برای فیلتر درختی). */
  async descendantIds(ctx: TenantRequestContext, id: string): Promise<string[]> {
    const all = await ctx.tenantDb.corrLetterCategory.findMany({ select: { id: true, parentId: true } });
    const out = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of all) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; }
    }
    return [...out];
  }

  private async assertNoCycle(ctx: TenantRequestContext, id: string, parentId: string | null | undefined) {
    if (!parentId) return;
    if (parentId === id) throw new BadRequestException('یک دسته نمی‌تواند والد خودش باشد');
    if ((await this.descendantIds(ctx, id)).includes(parentId)) throw new BadRequestException('والد انتخابی زیرمجموعه‌ی همین دسته است');
  }

  async createCategory(ctx: TenantRequestContext, dto: CategoryDto) {
    if (dto.parentId && !(await ctx.tenantDb.corrLetterCategory.findUnique({ where: { id: dto.parentId }, select: { id: true } }))) throw new BadRequestException('دسته‌ی والد یافت نشد');
    try {
      return await ctx.tenantDb.corrLetterCategory.create({ data: { code: dto.code.trim(), name: dto.name.trim(), parentId: dto.parentId ?? null, isActive: dto.isActive ?? true, sortOrder: dto.sortOrder ?? 0 } });
    } catch {
      throw new ConflictException('کد دسته تکراری است');
    }
  }

  async updateCategory(ctx: TenantRequestContext, id: string, dto: UpdateCategoryDto) {
    if (!(await ctx.tenantDb.corrLetterCategory.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('دسته یافت نشد');
    await this.assertNoCycle(ctx, id, dto.parentId);
    try {
      return await ctx.tenantDb.corrLetterCategory.update({
        where: { id },
        data: { code: dto.code?.trim(), name: dto.name?.trim(), parentId: dto.parentId, isActive: dto.isActive, sortOrder: dto.sortOrder },
      });
    } catch {
      throw new ConflictException('کد دسته تکراری است');
    }
  }

  async deleteCategory(ctx: TenantRequestContext, id: string) {
    const used = await ctx.tenantDb.corrLetter.count({ where: { categoryId: id } });
    if (used > 0) throw new ConflictException('این دسته در نامه‌ها استفاده شده است؛ به‌جای حذف، غیرفعالش کنید');
    const kids = await ctx.tenantDb.corrLetterCategory.count({ where: { parentId: id } });
    if (kids > 0) throw new ConflictException('ابتدا زیردسته‌ها را حذف کنید');
    await ctx.tenantDb.corrLetterCategory.delete({ where: { id } }).catch(() => undefined);
    return { success: true };
  }

  // ── طرح‌های شماره‌گذاری ────────────────────────────────────────────────
  listSchemes(ctx: TenantRequestContext) {
    return ctx.tenantDb.corrNumberingScheme.findMany({ orderBy: [{ type: 'asc' }, { createdAt: 'asc' }] });
  }

  async createScheme(ctx: TenantRequestContext, dto: NumberingSchemeDto) {
    this.numbering.assertValidPattern(validatePattern(dto.pattern, dto.resetPolicy ?? 'YEARLY'));
    if (dto.isActive !== false) await this.assertPatternFree(ctx, dto.type, dto.pattern.trim());
    return ctx.tenantDb.$transaction(async (tx) => {
      const makeDefault = dto.isDefault ?? !(await tx.corrNumberingScheme.count({ where: { type: dto.type, isActive: true } }));
      if (makeDefault) await tx.corrNumberingScheme.updateMany({ where: { type: dto.type }, data: { isDefault: false } });
      return tx.corrNumberingScheme.create({
        data: { name: dto.name.trim(), type: dto.type, pattern: dto.pattern.trim(), resetPolicy: dto.resetPolicy ?? 'YEARLY', startAt: dto.startAt ?? 1, isDefault: makeDefault, isActive: dto.isActive ?? true },
      });
    });
  }

  /**
   * ویرایش طرح: تغییر الگو/دوره فقط روی نامه‌های بعدی اثر دارد؛ شماره‌های صادرشده دست نمی‌خورند.
   * شمارنده‌ها به‌ازای (طرح، دوره) جدا هستند، پس تغییر سیاست بازنشانی شماره‌ی تکراری نمی‌سازد (یکتایی (نوع، شماره) در دیتابیس هم هست).
   */
  async updateScheme(ctx: TenantRequestContext, id: string, dto: UpdateNumberingSchemeDto) {
    const cur = await ctx.tenantDb.corrNumberingScheme.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('طرح یافت نشد');
    const pattern = (dto.pattern ?? cur.pattern).trim();
    const policy = dto.resetPolicy ?? cur.resetPolicy;
    if (dto.pattern || dto.resetPolicy) this.numbering.assertValidPattern(validatePattern(pattern, policy));
    if ((dto.isActive ?? cur.isActive) && (dto.pattern || dto.isActive)) await this.assertPatternFree(ctx, cur.type, pattern, id);
    return ctx.tenantDb.$transaction(async (tx) => {
      if (dto.isDefault) await tx.corrNumberingScheme.updateMany({ where: { type: cur.type, id: { not: id } }, data: { isDefault: false } });
      return tx.corrNumberingScheme.update({
        where: { id },
        data: { name: dto.name?.trim(), pattern: dto.pattern?.trim(), resetPolicy: dto.resetPolicy, startAt: dto.startAt, isDefault: dto.isDefault, isActive: dto.isActive },
      });
    });
  }

  /** دو طرح فعالِ هم‌نوع با الگوی یکسان، شماره‌ی تکراری می‌سازند (یکتایی (نوع، شماره) فقط در دیتابیس شکست می‌دهد). */
  private async assertPatternFree(ctx: TenantRequestContext, type: string, pattern: string, exceptId?: string) {
    const dup = await ctx.tenantDb.corrNumberingScheme.findFirst({ where: { type, pattern, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (dup) throw new ConflictException('یک طرح فعال دیگر از همین نوع با همین الگو وجود دارد؛ الگوی متفاوت انتخاب کنید یا آن را غیرفعال کنید');
  }

  async deleteScheme(ctx: TenantRequestContext, id: string) {
    const used = await ctx.tenantDb.corrLetter.count({ where: { numberingSchemeId: id } });
    if (used > 0) throw new ConflictException('از این طرح شماره صادر شده است؛ به‌جای حذف، غیرفعالش کنید');
    await ctx.tenantDb.corrNumberingScheme.delete({ where: { id } }).catch(() => undefined);
    return { success: true };
  }

  previewNext(ctx: TenantRequestContext, type: string, categoryId?: string) {
    if (!isLetterType(type)) throw new BadRequestException('نوع نامه نامعتبر است');
    return this.numbering.preview(ctx.tenantDb, type as LetterType, categoryId);
  }

  // ── پوشه‌های بایگانی ───────────────────────────────────────────────────
  listFolders(ctx: TenantRequestContext) {
    return ctx.tenantDb.corrArchiveFolder.findMany({ orderBy: { name: 'asc' } });
  }
  createFolder(ctx: TenantRequestContext, dto: FolderDto) {
    return ctx.tenantDb.corrArchiveFolder.create({ data: { name: dto.name.trim(), parentId: dto.parentId ?? null, retentionDays: dto.retentionDays ?? null } });
  }
  async updateFolder(ctx: TenantRequestContext, id: string, dto: Partial<FolderDto>) {
    if (dto.parentId === id) throw new BadRequestException('پوشه نمی‌تواند والد خودش باشد');
    if (dto.parentId) {
      // والد جدید نباید نوه‌ی همین پوشه باشد: زنجیره‌ی والدهای والد جدید را تا ریشه بالا می‌رویم
      const all = await ctx.tenantDb.corrArchiveFolder.findMany({ select: { id: true, parentId: true } });
      const parentOf = new Map(all.map((f) => [f.id, f.parentId]));
      if (!parentOf.has(dto.parentId)) throw new BadRequestException('پوشه‌ی والد یافت نشد');
      let cur: string | null | undefined = dto.parentId;
      for (let depth = 0; cur && depth < 100; depth++) {
        if (cur === id) throw new BadRequestException('والد انتخابی زیرمجموعه‌ی همین پوشه است');
        cur = parentOf.get(cur);
      }
    }
    return ctx.tenantDb.corrArchiveFolder.update({ where: { id }, data: { name: dto.name?.trim(), parentId: dto.parentId, retentionDays: dto.retentionDays } }).catch(() => {
      throw new NotFoundException('پوشه یافت نشد');
    });
  }
  async deleteFolder(ctx: TenantRequestContext, id: string) {
    const used = await ctx.tenantDb.corrLetter.count({ where: { archiveFolderId: id } });
    const kids = await ctx.tenantDb.corrArchiveFolder.count({ where: { parentId: id } });
    if (used > 0 || kids > 0) throw new ConflictException('پوشه خالی نیست');
    await ctx.tenantDb.corrArchiveFolder.delete({ where: { id } }).catch(() => undefined);
    return { success: true };
  }
}
