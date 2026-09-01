import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min, MinLength, ValidateNested } from 'class-validator';

class PurchaseOrderLineDto {
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
  unitCost!: number;

  @IsOptional()
  @IsUUID()
  currencyId?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  unitCostFx?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  exchangeRateFx?: number;
}

export class CreatePurchaseOrderDto {
  @IsUUID()
  supplierId!: string;

  @IsOptional()
  @IsISO8601()
  expectedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
}
