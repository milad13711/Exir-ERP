import { IsBoolean, IsString } from 'class-validator';

export class UpdateFleetSmsSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  offerDispatchTemplate!: string;

  @IsString()
  offerAcceptedTemplate!: string;

  @IsString()
  deliveredSurveyTemplate!: string;
}
