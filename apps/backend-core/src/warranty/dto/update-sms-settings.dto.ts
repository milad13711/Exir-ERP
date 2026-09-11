import { IsBoolean, IsString } from 'class-validator';

export class UpdateWarrantySmsSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  activationCustomerEnabled!: boolean;

  @IsString()
  activationCustomerTemplate!: string;

  @IsBoolean()
  activationStaffEnabled!: boolean;

  @IsString()
  activationStaffTemplate!: string;
}
