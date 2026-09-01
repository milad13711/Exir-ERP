import { IsInt, Min } from 'class-validator';

export class UpdateCheckReminderDto {
  @IsInt()
  @Min(0)
  reminderDaysBefore!: number;
}
