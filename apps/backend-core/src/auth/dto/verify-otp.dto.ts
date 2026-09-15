import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;

  @IsString()
  @Length(4, 4, { message: 'کد تأیید باید ۴ رقم باشد' })
  code!: string;

  // اختیاری: وقتی حذف شود و این شماره عضو بیش از یک محیط کاری فعال باشد،
  // پاسخ به‌جای accessToken یک لیست انتخاب محیط کاری برمی‌گرداند — به
  // AuthService.verifyOtp نگاه کنید.
  @IsOptional()
  @IsString()
  tenantSlug?: string;
}
