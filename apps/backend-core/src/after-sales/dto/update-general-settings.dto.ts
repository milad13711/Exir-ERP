import { IsOptional, IsString } from 'class-validator';

export class UpdateAfterSalesGeneralSettingsDto {
  @IsOptional()
  @IsString()
  serviceTermsConditions?: string;

  @IsOptional()
  @IsString()
  serviceManagerUserId?: string;
}
