import { IsString, Matches } from 'class-validator';

export class RequestStoreOtpDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;
}
