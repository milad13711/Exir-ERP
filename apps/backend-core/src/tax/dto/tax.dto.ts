import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class UpdateTaxSettingsDto {
  @IsOptional() @IsString() @Matches(/^(\d{10}|\d{14})?$/, { message: 'شماره اقتصادی باید ۱۰ یا ۱۴ رقم باشد' }) economicCode?: string;
  @IsOptional() @IsString() @Matches(/^([0-9A-Za-z]{6})?$/, { message: 'شناسه حافظه مالیاتی ۶ نویسه است' }) fiscalId?: string;
  @IsOptional() @IsString() @MaxLength(200) taxpayerName?: string;
  @IsOptional() @IsString() @Matches(/^(\d{10})?$/, { message: 'کد پستی ۱۰ رقم است' }) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(20) branchCode?: string;
  @IsOptional() @IsIn(['SANDBOX', 'PRODUCTION']) environment?: 'SANDBOX' | 'PRODUCTION';
  @IsOptional() @IsBoolean() sendingEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(300) sandboxBaseUrl?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) defaultVatRate?: number | null;
  @IsOptional() @IsString() @Matches(/^(\d{13})?$/, { message: 'شناسه کالا/خدمت ۱۳ رقم است' }) defaultSstid?: string;
  @IsOptional() @IsInt() @Min(1) @Max(99999) defaultUnitCode?: number | null;
}

export class UploadTaxKeyDto {
  @IsString() @MinLength(100) @MaxLength(20000) privateKeyPem!: string;
  @IsOptional() @IsString() @MaxLength(20000) certificatePem?: string;
  @IsOptional() @IsString() @MaxLength(100) signatureKeyId?: string;
}

export class TaxOverridesDto {
  @IsOptional() @IsString() @Matches(/^(\d{10})?$/) buyerPostalCode?: string;
  @IsOptional() @IsString() @Matches(/^(\d{10}|\d{14})?$/) buyerEconomicCode?: string;
  @IsOptional() @IsString() @MaxLength(20) buyerId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) buyerType?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3) invoiceType?: number;
  @IsOptional() @IsString() @MaxLength(20) branchCode?: string;
  @IsOptional() @IsString() @MaxLength(20) buyerBranchCode?: string;
}

export class CreateTaxInvoiceDto {
  @IsUUID() salesInvoiceId!: string;
}

export class UpdateTaxInvoiceDto {
  @IsOptional() @IsString() @Matches(/^([0-9A-Fa-f]{22})?$/, { message: 'taxid باید ۲۲ نویسه‌ی هگز باشد' }) taxid?: string;
  @IsOptional() @ValidateNested() @Type(() => TaxOverridesDto) overrides?: TaxOverridesDto;
}

export class DecideTaxInvoiceDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ChainTaxInvoiceDto {
  @IsIn(['CANCELLATION', 'CORRECTION']) kind!: 'CANCELLATION' | 'CORRECTION';
  @IsOptional() @IsString() @Matches(/^([0-9A-Fa-f]{22})?$/) taxid?: string;
}

export class UpsertTaxProductCodeDto {
  @IsUUID() productId!: string;
  @IsString() @Matches(/^\d{13}$/, { message: 'شناسه کالا/خدمت باید ۱۳ رقم باشد' }) sstid!: string;
  @IsInt() @Min(1) @Max(99999) unitCode!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) vatRate?: number | null;
}
