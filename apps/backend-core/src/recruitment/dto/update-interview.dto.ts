import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const STATUSES = ['SCHEDULED', 'DONE', 'CANCELLED', 'NO_SHOW'] as const;

export class UpdateInterviewDto {
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  interviewerUserId?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}
