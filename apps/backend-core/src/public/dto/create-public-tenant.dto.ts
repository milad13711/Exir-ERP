import { IsArray, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreatePublicTenantDto {
  /** Short-lived JWT from POST /public/signup/otp/verify, proves phone ownership. */
  @IsString()
  signupToken!: string;

  @IsString()
  @MinLength(2)
  businessName!: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9-]{1,48}$/, {
    message: 'شناسه باید فقط شامل حروف کوچک انگلیسی، عدد و خط تیره باشد',
  })
  slug!: string;

  @IsString()
  @MinLength(2)
  ownerName!: string;

  @IsString()
  planCode!: string;

  /** Omitted (or a non-existent code) means "شروع با فضای کاری عمومی" — no industry template applied. */
  @IsOptional()
  @IsString()
  industryTemplateCode?: string;

  /** مسیر «شخصی‌سازی برای کسب‌وکار من» — ماژول‌های اضافه‌ی دستی‌انتخاب‌شده، فراتر از پیش‌فرض‌های صنف. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  extraModuleCodes?: string[];
}
