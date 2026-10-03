import { IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateFixedAssetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsISO8601()
  purchaseDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  purchaseCost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salvageValue?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usefulLifeMonths?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
