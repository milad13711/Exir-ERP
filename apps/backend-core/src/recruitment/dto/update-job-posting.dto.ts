import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

const EMPLOYMENT_TYPES = ['INTERN', 'PROJECT_BASED', 'PART_TIME', 'FULL_TIME'] as const;

export class UpdateJobPostingDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  jobField?: string;

  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsString()
  publishChannel?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  publishBudget?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  contractId?: string | null;

  @IsOptional()
  @IsString()
  contractTemplateId?: string | null;
}
