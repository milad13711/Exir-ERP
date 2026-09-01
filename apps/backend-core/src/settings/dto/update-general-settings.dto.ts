import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class UpdateGeneralSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  orgName?: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  // Used to fill in the header/footer of generated PDFs (invoices, etc.) —
  // see InvoicePdfService.
  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  economicCode?: string; // کد اقتصادی

  @IsOptional()
  @IsString()
  nationalId?: string; // شناسه ملی

  @IsOptional()
  @IsString()
  registrationNumber?: string; // شماره ثبت

  @IsOptional()
  @IsString()
  phone?: string;
}
