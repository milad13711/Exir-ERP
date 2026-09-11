import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateWarrantyGeneralSettingsDto {
  @IsInt()
  @Min(1)
  defaultDurationDays!: number;

  @IsInt()
  @Min(1)
  reminderDaysBeforeExpiry!: number;

  @IsOptional()
  @IsString()
  termsConditions?: string;

  @IsOptional()
  @IsString()
  serviceTermsConditions?: string;

  @IsOptional()
  @IsString()
  warrantyManagerUserId?: string;

  @IsOptional()
  @IsString()
  serviceManagerUserId?: string;
}
