import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

const PRICING_MODELS = ['HOURLY', 'PACKAGE', 'PROJECT_BASED', 'SUBSCRIPTION'] as const;

export class CreateEngagementDto {
  @IsString()
  contactId!: string;

  @IsString()
  advisorUserId!: string;

  @IsString()
  @MinLength(2)
  title!: string;

  @IsIn(PRICING_MODELS)
  pricingModel!: (typeof PRICING_MODELS)[number];

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
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
