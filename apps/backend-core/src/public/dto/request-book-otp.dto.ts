import { IsString, Matches } from 'class-validator';

export class RequestBookOtpDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;
}
