import { IsInt, Max, Min } from 'class-validator';

export class GeneratePayrollDto {
  @IsInt()
  @Min(1300)
  @Max(1500)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

export class UpdatePayrollDto {
  @IsInt()
  @Min(0)
  allowances!: number;

  @IsInt()
  @Min(0)
  deductions!: number;
}
