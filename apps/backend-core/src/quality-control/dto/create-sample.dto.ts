import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSampleDto {
  @IsUUID()
  productionOrderId!: string;

  @IsOptional()
  @IsUUID()
  productionOrderStageId?: string;

  @IsIn(['IN_PROCESS', 'FINAL_PRODUCT'])
  source!: 'IN_PROCESS' | 'FINAL_PRODUCT';

  @IsOptional()
  @IsString()
  note?: string;
}
