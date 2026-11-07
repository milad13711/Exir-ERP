import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsISO8601, IsInt, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

class UpdateStageInputDto {
  @IsUUID()
  workCenterId!: string;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;
}

/** ویرایش دستور تولید — فقط وقتی هنوز DRAFT است (موادی مصرف نشده). */
export class UpdateProductionOrderDto {
  @IsOptional()
  @IsUUID()
  bomId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantityPlanned?: number;

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
  @Type(() => UpdateStageInputDto)
  stages?: UpdateStageInputDto[];
}
