import { IsString, Length, Matches } from 'class-validator';

export class VerifyBookOtpDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;

  @IsString()
  @Length(4, 4, { message: 'کد تأیید باید ۴ رقم باشد' })
  code!: string;
}
