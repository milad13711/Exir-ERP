import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateShipmentDto {
  @IsOptional()
  @IsIn(['MANUAL', 'STOCK_MOVEMENT', 'SALES_INVOICE'])
  sourceType?: 'MANUAL' | 'STOCK_MOVEMENT' | 'SALES_INVOICE';

  @IsOptional()
  @IsString()
  sourceStockMovementId?: string;

  @IsOptional()
  @IsString()
  sourceInvoiceId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsString()
  @MinLength(1)
  cargoType!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsString()
  @MinLength(2)
  deliveryAddress!: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsDateString()
  pickupAt!: string;
}
