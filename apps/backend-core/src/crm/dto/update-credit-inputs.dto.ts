import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateCreditInputsDto {
  @IsOptional()
  @IsBoolean()
  hasBouncedChecks?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  bankAvgMonthlyTurnover?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  creditLimitOverride?: number | null;
}
