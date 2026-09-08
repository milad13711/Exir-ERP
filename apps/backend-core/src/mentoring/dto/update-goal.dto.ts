import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

const GOAL_STATUSES = ['IN_PROGRESS', 'ACHIEVED', 'MISSED', 'CANCELLED'] as const;

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

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

  @IsOptional()
  @IsIn(GOAL_STATUSES)
  status?: (typeof GOAL_STATUSES)[number];
}
