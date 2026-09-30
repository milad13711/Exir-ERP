import { IsBoolean, IsString } from 'class-validator';

export class UpdateMentoringSmsSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  scheduledContactTemplate!: string;

  @IsString()
  scheduledAdvisorTemplate!: string;

  @IsString()
  reminderContactTemplate!: string;

  @IsString()
  reminderAdvisorTemplate!: string;

  @IsString()
  surveyTemplate!: string;
}
