import { IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class InvoiceLineDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(0)
  amount!: number;
}

export class UpdateInvoiceDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  /** فقط برای اصلاح دستی وضعیت به «در انتظار/ناموفق»؛ ثبت پرداخت فقط از mark-paid (تا اثرش روی اشتراک/ماژول‌ها درست اعمال شود). */
  @IsOptional()
  @IsIn(['PENDING', 'FAILED'])
  status?: 'PENDING' | 'FAILED';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines?: InvoiceLineDto[];
}
