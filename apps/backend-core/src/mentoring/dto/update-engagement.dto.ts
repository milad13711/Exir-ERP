import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

const PRICING_MODELS = ['HOURLY', 'PACKAGE', 'PROJECT_BASED', 'SUBSCRIPTION'] as const;
const STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const;

export class UpdateEngagementDto {
  @IsOptional()
  @IsString()
  advisorUserId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsIn(PRICING_MODELS)
  pricingModel?: (typeof PRICING_MODELS)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  hourlyRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  packageSessionsCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  packagePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  subscriptionMonthlyPrice?: number;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
