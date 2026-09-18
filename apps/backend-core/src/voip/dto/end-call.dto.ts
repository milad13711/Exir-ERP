import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

const STATUSES = ['ANSWERED', 'MISSED', 'NO_ANSWER', 'FAILED'] as const;

export class EndCallDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;
}
