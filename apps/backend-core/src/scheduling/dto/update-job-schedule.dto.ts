import { IsIn, IsInt, Max, Min } from 'class-validator';
import type { ScheduleOffsetUnit } from '../schedule-match.util.js';

export class UpdateJobScheduleDto {
  @IsInt()
  @Min(0)
  offsetDays!: number;

  @IsIn(['DAYS_BEFORE', 'SAME_DAY', 'DAYS_AFTER'])
  unit!: ScheduleOffsetUnit;

  @IsInt()
  @Min(0)
  @Max(23)
  hour!: number;

  @IsInt()
  @Min(0)
  @Max(59)
  minute!: number;
}
