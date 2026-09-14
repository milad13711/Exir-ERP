import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ScheduleInterviewDto {
  @IsString()
  applicantId!: string;

  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  interviewerUserId?: string;
}
