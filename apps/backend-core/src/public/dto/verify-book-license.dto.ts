import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class VerifyBookLicenseDto {
  @Type(() => Number)
  @IsInt({ message: 'شماره سفارش نامعتبر است' })
  @Min(1)
  @Max(2_000_000_000)
  orderNo!: number;

  @IsString()
  @Matches(/^(\+?98|0)?9\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;

  @IsString()
  @MaxLength(40)
  code!: string;
}
