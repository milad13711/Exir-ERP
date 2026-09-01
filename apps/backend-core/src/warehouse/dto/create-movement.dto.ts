import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateMovementDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsIn(['RECEIPT', 'ISSUE', 'ADJUSTMENT'])
  type!: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT';

  /** For RECEIPT/ISSUE: a positive count. For ADJUSTMENT: the signed change (+/-). */
  @IsInt()
  quantity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
