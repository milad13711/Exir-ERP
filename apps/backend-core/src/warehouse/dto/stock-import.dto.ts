import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class StockImportPreviewDto {
  @IsString()
  @MinLength(1)
  fileBase64!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fileName?: string;

  /** ساخت خودکار کالاهایی که در سیستم نیستند (با نام/واحد/بهای فایل). */
  @IsOptional()
  @IsBoolean()
  createMissingProducts?: boolean;
}

export class StockImportCommitDto extends StockImportPreviewDto {
  /** هش فایلی که پیش‌نمایش شد؛ اگر با فایل ارسالی نخواند، ثبت نمی‌شود (همان فایلی که دیدید ثبت می‌شود). */
  @IsString()
  @MinLength(64)
  @MaxLength(64)
  fileHash!: string;

  /** تأیید صریح کاربر پس از دیدن پیش‌نمایش. */
  @IsBoolean()
  confirm!: boolean;
}

export class StockImportVoidDto {
  @IsString()
  @MinLength(3, { message: 'دلیل ابطال را بنویسید' })
  reason!: string;
}
