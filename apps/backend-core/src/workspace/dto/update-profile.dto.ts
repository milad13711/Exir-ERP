import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  /** ۲ تا ۸۰ نویسه؛ پاک‌سازی و پیام فارسی در normalizeDisplayName */
  @IsOptional()
  @IsString({ message: 'نام نامعتبر است' })
  @MaxLength(400, { message: 'نام بیش از حد طولانی است' })
  name?: string;

  @IsOptional()
  @ValidateIf((o) => o.email !== null)
  @IsString()
  email?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.avatarUrl !== null)
  @IsString({ message: 'تصویر پروفایل نامعتبر است' })
  @MaxLength(3_000_000, { message: 'تصویر پروفایل بیش از حد بزرگ است' })
  avatarUrl?: string | null;
}
