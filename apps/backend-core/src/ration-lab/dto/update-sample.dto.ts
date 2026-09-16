import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { RationCurrentLineDto } from './create-sample.dto.js';

/** فقط پیش از تأیید تحویل آزمایشگاه قابل استفاده — بعد از آن، سرویس خودش رد می‌کند. */
export class UpdateSampleDto {
  @IsOptional()
  @IsDateString()
  collectedAt?: string;

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

  @IsOptional()
  @IsInt()
  @Min(0)
  analysisFeeAmount?: number;

  @IsOptional()
  @IsString()
  discountCode?: string;
}
