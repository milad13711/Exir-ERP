import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * یک ردیف گارانتی قدیمی — مطابق ستون‌های خروجی اکسل/CSV ماژول قبلی (کد،
 * توضیح کالا، شماره فاکتور، شماره سریال، مدت گارانتی، وضعیت، تاریخ‌ها، و
 * اطلاعات مشتری فعال‌کننده). پارس فایل CSV/Excel در مرورگر انجام می‌شود؛
 * این DTO فقط ردیف‌های از‌پیش‌پارس‌شده را می‌پذیرد — این سیستم لایه‌ی
 * آپلود فایل چندبخشی ندارد.
 */
export class ImportLegacyWarrantyRowDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  itemDescription?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  durationDays?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  issuedAt?: string;

  @IsOptional()
  @IsString()
  activatedAt?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsString()
  clientPhone?: string;

  @IsOptional()
  @IsString()
  clientEmail?: string;
}

export class ImportLegacyWarrantiesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportLegacyWarrantyRowDto)
  rows!: ImportLegacyWarrantyRowDto[];
}
