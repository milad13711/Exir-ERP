import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class UpdateBomLineDto {
  @IsUUID()
  rawMaterialProductId!: string;

  @IsInt()
  @Min(1)
  quantityPerBatch!: number;
}

export class UpdateBomDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  batchOutputQty?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateBomLineDto)
  lines?: UpdateBomLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
