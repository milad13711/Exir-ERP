import { IsBoolean, IsString } from 'class-validator';

export class UpdateReferralSmsSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  npsSurveyTemplate!: string;
}
