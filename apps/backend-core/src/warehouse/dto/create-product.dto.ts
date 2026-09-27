import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Min, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  sku!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderPoint?: number;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  costPriceFx?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  salePriceFx?: number;

  // وقتی ست شود و costPrice هم موجود باشد، قیمت فروش با
  // salePrice = costPrice * (1 + profitMarginPercent/100) محاسبه می‌شود
  // (اگر تنظیم سراسری «محاسبه خودکار قیمت فروش از درصد سود» فعال باشد).
  @IsOptional()
  @IsNumber()
  @Min(0)
  profitMarginPercent?: number;
}
