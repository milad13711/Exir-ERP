import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class BomLineDto {
  @IsUUID()
  rawMaterialProductId!: string;

  @IsInt()
  @Min(1)
  quantityPerBatch!: number;
}

export class CreateBomDto {
  @IsUUID()
  outputProductId!: string;

  @IsInt()
  @Min(1)
  batchOutputQty!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BomLineDto)
  lines!: BomLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
