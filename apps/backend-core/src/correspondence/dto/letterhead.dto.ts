import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLetterheadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsIn(['A4', 'A5'])
  pageSize?: 'A4' | 'A5';

  @IsOptional()
  @IsIn(['portrait', 'landscape'])
  orientation?: 'portrait' | 'landscape';

  /** LetterheadLayout — در سرویس سخت‌گیرانه اعتبارسنجی می‌شود. اگر نباشد چیدمان پیش‌فرض ساخته می‌شود. */
  @IsOptional()
  @IsObject()
  layout?: Record<string, unknown>;

  /** data-URI تصویر PNG/JPEG (≤ ۳ مگابایت)؛ null = بدون تصویر. */
  @IsOptional()
  @IsString()
  @MaxLength(4_400_000)
  backgroundImage?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  departmentId?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateLetterheadDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['A4', 'A5'])
  pageSize?: 'A4' | 'A5';

  @IsOptional()
  @IsIn(['portrait', 'landscape'])
  orientation?: 'portrait' | 'landscape';

  @IsOptional()
  @IsObject()
  layout?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(4_400_000)
  backgroundImage?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  departmentId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** پیش‌نمایش PDF از «فیلدهای پیش‌نویس» — هرگز LetterRenderInput خام؛ بدنه سمت سرور پاک‌سازی و ورودی ساخته می‌شود. */
export class PreviewPdfDto {
  @IsOptional() @IsString() @MaxLength(100) letterheadId?: string;
  @IsOptional() @IsString() @MaxLength(100) templateId?: string;
  @IsOptional() @IsString() @MaxLength(100) departmentId?: string;
  @IsOptional() @IsString() @MaxLength(100) number?: string;
  @IsOptional() @IsString() @MaxLength(100) dateText?: string;
  @IsOptional() @IsString() @MaxLength(2000) subject?: string;
  @IsOptional() @IsString() @MaxLength(700_000) bodyHtml?: string;
  @IsOptional() @IsString() @MaxLength(2000) attachmentsText?: string;
  @IsOptional() @IsString() @MaxLength(300) recipientName?: string;
  @IsOptional() @IsString() @MaxLength(300) recipientTitle?: string;
  @IsOptional() @IsString() @MaxLength(300) senderName?: string;
  @IsOptional() @IsString() @MaxLength(300) senderTitle?: string;
  @IsOptional() @IsString() @MaxLength(100) confidentialityLabel?: string;
  @IsOptional() @IsString() @MaxLength(100) priorityLabel?: string;
  @IsOptional() @IsIn(['DRAFT', 'VOID']) watermark?: 'DRAFT' | 'VOID';
  @IsOptional() @IsBoolean() withSignature?: boolean;
  @IsOptional() @IsBoolean() withQr?: boolean;
  @IsOptional() @IsBoolean() persianDigits?: boolean;
}

export class SamplePdfDto {
  @IsOptional() @IsIn(['A4', 'A5']) pageSize?: 'A4' | 'A5';
  @IsOptional() @IsIn(['portrait', 'landscape']) orientation?: 'portrait' | 'landscape';
  /** true = متن نمونه‌ی بلند (چندصفحه‌ای) برای آزمودن ادامه‌ی صفحات */
  @IsOptional() @IsBoolean() long?: boolean;
  @IsOptional() @IsBoolean() persianDigits?: boolean;
  /** پیش‌نمایش پیش از ذخیره: چیدمان/تصویر جاری طراح (به‌جای نسخه‌ی ذخیره‌شده). سخت‌گیرانه اعتبارسنجی می‌شود. */
  @IsOptional() @IsObject() layout?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(4_400_000) backgroundImage?: string | null;
}
