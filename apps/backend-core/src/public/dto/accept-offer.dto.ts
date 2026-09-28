import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class AcceptOfferDto {
  @IsBoolean()
  accepted!: boolean;

  /** امضای الکترونیک متقاضی (data URL تصویر) — برای پذیرش الزامی است. */
  @IsOptional()
  @IsString()
  @MaxLength(400_000)
  signature?: string;

  /** کد ملی متقاضی */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  nationalId?: string;

  /** تصویر کارت ملی متقاضی — data URL (base64)، همان الگوی CompanyStampService */
  @IsOptional()
  @IsString()
  idCardImage?: string;
}
