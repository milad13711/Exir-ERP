import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateDashboardReminderDto {
  /** "YYYY-MM-DD" (Gregorian ISO) — روز یادآوری، بدون بخش ساعت. */
  @IsISO8601()
  date!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
