import { Type } from 'class-transformer';
import { IsArray, IsInt, IsISO8601, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class ManualInvoiceLineDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(0)
  amount!: number;
}

export class CreateInvoiceDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsISO8601()
  dueAt!: string;

  @IsOptional()
  @IsString()
  subscriptionId?: string;

  /** ردیف‌های دستی فاکتور (شرح + مبلغ) — برای فاکتور دستی صادرشده توسط ادمین */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualInvoiceLineDto)
  lines?: ManualInvoiceLineDto[];
}
