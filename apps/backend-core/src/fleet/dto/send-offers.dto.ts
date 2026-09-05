import { IsArray, IsOptional, IsString } from 'class-validator';

export class SendOffersDto {
  /** اگر مشخص شود، همین ترتیب دستی کاربر استفاده می‌شود؛ در غیر این صورت الگوریتم تطبیق به‌صورت خودکار اجرا می‌شود. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  driverIds?: string[];
}
