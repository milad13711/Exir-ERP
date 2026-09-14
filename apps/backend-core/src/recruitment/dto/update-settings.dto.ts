import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateRecruitmentGeneralSettingsDto {
  @IsInt()
  @Min(5)
  defaultInterviewMinutes!: number;

  @IsInt()
  @Min(0)
  bufferMinutesBetweenInterviews!: number;
}

export class UpdateRecruitmentSmsSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  specialistApprovedTemplate!: string;

  @IsString()
  specialistRejectedTemplate!: string;

  @IsString()
  managementApprovedTemplate!: string;

  @IsString()
  managementRejectedTemplate!: string;

  @IsOptional()
  @IsString()
  interviewInvitationTemplate?: string;
}
