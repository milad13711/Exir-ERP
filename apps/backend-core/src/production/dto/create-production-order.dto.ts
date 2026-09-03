import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsISO8601, IsInt, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

class ProductionStageInputDto {
  @IsUUID()
  workCenterId!: string;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;
}

export class CreateProductionOrderDto {
  @IsUUID()
  bomId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsInt()
  @Min(1)
  quantityPlanned!: number;

  @IsOptional()
  @IsUUID()
  relatedInvoiceId?: string;

  @IsOptional()
  @IsISO8601()
  plannedStartAt?: string;

  @IsOptional()
  @IsISO8601()
  plannedEndAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductionStageInputDto)
  stages?: ProductionStageInputDto[];
}
