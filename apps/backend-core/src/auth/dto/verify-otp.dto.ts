import { IsOptional, IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;

  @IsString()
  @Matches(/^(\d{4}|\d{6})$/, { message: 'کد تأیید باید ۴ یا ۶ رقم باشد' })
  code!: string;

  // اختیاری: وقتی حذف شود و این شماره عضو بیش از یک محیط کاری فعال باشد،
  // پاسخ به‌جای accessToken یک لیست انتخاب محیط کاری برمی‌گرداند — به
  // AuthService.verifyOtp نگاه کنید.
  @IsOptional()
  @IsString()
  tenantSlug?: string;
}
