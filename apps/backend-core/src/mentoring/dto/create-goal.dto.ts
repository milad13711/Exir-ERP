import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

const GOAL_TYPES = ['QUANTITATIVE', 'QUALITATIVE'] as const;

export class CreateGoalDto {
  @IsString()
  engagementId!: string;

  @IsString()
  @MinLength(2)
  title!: string;

  @IsIn(GOAL_TYPES)
  type!: (typeof GOAL_TYPES)[number];

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  baselineValue?: number;

  @IsOptional()
  @IsNumber()
  targetValue?: number;

  @IsOptional()
  @IsDateString()
  targetDate?: string;
}
