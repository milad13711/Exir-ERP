import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';

export class WarrantySmsQuickTemplateDto {
  @IsString()
  title!: string;

  @IsString()
  text!: string;
}

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

  @IsBoolean()
  serviceNewStaffEnabled!: boolean;

  @IsString()
  serviceNewStaffTemplate!: string;

  @IsBoolean()
  serviceStatusCustomerEnabled!: boolean;

  @IsString()
  serviceStatusCustomerTemplate!: string;

  @IsBoolean()
  serviceStatusStaffEnabled!: boolean;

  @IsString()
  serviceStatusStaffTemplate!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WarrantySmsQuickTemplateDto)
  quickTemplates!: WarrantySmsQuickTemplateDto[];
}
