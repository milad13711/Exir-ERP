import { IsBoolean, IsString } from 'class-validator';

export class UpdateChecksSmsSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  dueReminderReceivedTemplate!: string;

  @IsString()
  dueReminderIssuedTemplate!: string;

  @IsString()
  bounceAlertTemplate!: string;
}
