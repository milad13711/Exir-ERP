import { IsInt, Max, Min } from 'class-validator';

export class UpdatePayrollTaxSettingsDto {
  @IsInt()
  @Min(0)
  @Max(100)
  insuranceEmployeeRate!: number;

  @IsInt()
  @Min(0)
  taxExemptionMonthly!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  taxRate!: number;
}
