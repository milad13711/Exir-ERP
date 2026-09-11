import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';

export class AfterSalesSmsQuickTemplateDto {
  @IsString()
  title!: string;

  @IsString()
  text!: string;
}

export class UpdateAfterSalesSmsSettingsDto {
  @IsBoolean()
  enabled!: boolean;

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
  @Type(() => AfterSalesSmsQuickTemplateDto)
  quickTemplates!: AfterSalesSmsQuickTemplateDto[];
}
