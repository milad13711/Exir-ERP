import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsHttpUrl } from '../../common/validators/is-http-url.js';

export class UpdateMyResellerProfileDto {
  /** عکس/لوگو به‌صورت data URI (فرانت قبل از ارسال کوچکش می‌کند) */
  @IsOptional()
  @IsString()
  @MaxLength(400_000)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  bio?: string;

  @IsOptional()
  @IsString()
  @IsHttpUrl()
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
