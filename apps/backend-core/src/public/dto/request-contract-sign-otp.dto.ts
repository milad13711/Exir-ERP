import { IsString, Matches } from 'class-validator';

export class RequestContractSignOtpDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;
}
