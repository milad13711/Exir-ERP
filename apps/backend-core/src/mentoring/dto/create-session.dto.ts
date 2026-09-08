import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const MODES = ['ONLINE', 'PHONE', 'IN_PERSON'] as const;

export class CreateSessionDto {
  @IsString()
  engagementId!: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsOptional()
  @IsIn(MODES)
  mode?: (typeof MODES)[number];

  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  location?: string;
}
