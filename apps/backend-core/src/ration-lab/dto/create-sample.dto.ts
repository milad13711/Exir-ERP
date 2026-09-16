import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class RationCurrentLineDto {
  @IsString()
  ingredientName!: string;

  @IsNumber()
  quantityPerAnimalKg!: number;

  @IsInt()
  @Min(0)
  unitCostSnapshot!: number;
}

export class CreateSampleDto {
  @IsUUID()
  contactId!: string;

  @IsDateString()
  collectedAt!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  herdSize?: number;

  @IsOptional()
  @IsNumber()
  totalHerdMilkYieldLiters?: number;

  @IsOptional()
  @IsNumber()
  avgMilkYieldPerAnimalLiters?: number;

  @IsOptional()
  @IsNumber()
  milkFatPercent?: number;

  @IsOptional()
  @IsNumber()
  milkProteinPercent?: number;

  @IsOptional()
  @IsString()
  currentRationDescription?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RationCurrentLineDto)
  currentLines?: RationCurrentLineDto[];

  @IsString()
  consentSignatureDataUrl!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  analysisFeeAmount?: number;

  @IsOptional()
  @IsString()
  discountCode?: string;

  @IsOptional()
  @IsBoolean()
  isIdentityVisibleToLab?: boolean;
}
