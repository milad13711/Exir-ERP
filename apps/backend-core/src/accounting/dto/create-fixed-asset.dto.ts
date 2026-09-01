import { IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateFixedAssetDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsISO8601()
  purchaseDate!: string;

  @IsInt()
  @Min(0)
  purchaseCost!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salvageValue?: number;

  @IsInt()
  @Min(1)
  usefulLifeMonths!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
