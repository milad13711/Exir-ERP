import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CompleteFollowupDto {
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
  notes?: string;
}
