import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, Min, MinLength, ValidateNested } from 'class-validator';

class InvoiceLineDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsInt()
  @Min(0)
  unitPrice!: number;

  // فقط برای رهگیری/نمایش — نرخ لحظه‌ی ثبت وقتی این قلم از یک کالای ارزی پر شده.
  @IsOptional()
  @IsUUID()
  currencyId?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  unitPriceFx?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  exchangeRateFx?: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  contactId!: string;

  @IsOptional()
  @IsUUID()
  dealId?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isOfficial?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}
