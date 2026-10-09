import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetTenantUserTwoFactorDto {
  /** دلیل بازنشانی (ثبت در لاگ حسابرسی) — مثلاً شماره‌ی تیکت و تأیید هویت تلفنی/حضوری. */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class SetTenantTwoFactorPolicyDto {
  /** null = پیروی از env سراسری */
  @IsOptional()
  @IsIn(['off', 'grace', 'enforce'])
  policy?: 'off' | 'grace' | 'enforce' | null;
}
