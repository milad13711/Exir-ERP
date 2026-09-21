import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, ValidateNested } from 'class-validator';

class ModuleInvoiceItemDto {
  @IsString()
  code!: string;

  /** MONTHLY/YEARLY = اشتراک زمان‌دار؛ LICENSE = لایسنس مادام‌العمر */
  @IsIn(['MONTHLY', 'YEARLY', 'LICENSE'])
  billingMode!: 'MONTHLY' | 'YEARLY' | 'LICENSE';
}

export class CreateModuleInvoiceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ModuleInvoiceItemDto)
  items!: ModuleInvoiceItemDto[];

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  /** پیام اختیاری که همراه اعلان برای تننت می‌آید */
  @IsOptional()
  @IsString()
  note?: string;
}
