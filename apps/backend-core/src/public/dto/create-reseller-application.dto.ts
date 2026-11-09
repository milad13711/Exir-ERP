import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsHttpUrl } from '../../common/validators/is-http-url.js';

/**
 * فرم «همکاری با ما» (eta.co.ir/collaborate). درخواست در صف «نمایندگی ← درخواست‌ها»ی تننت اصلی بررسی می‌شود.
 * productCode = کد محصول ماژول نمایندگی (کدهای قدیمی ERP/REAL_ESTATE/SMS_GATEWAY/OTHER هم همین الگو را دارند).
 */
export class CreateResellerApplicationDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(160) company?: string;
  @IsString() @MinLength(10) @MaxLength(20) @Matches(/^[0-9۰-۹+\s-]+$/, { message: 'شماره‌ی تماس نامعتبر است' }) phone!: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(300) @IsHttpUrl() websiteUrl?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,31}$/, { message: 'محصول نامعتبر است' }) productCode?: string;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
}
