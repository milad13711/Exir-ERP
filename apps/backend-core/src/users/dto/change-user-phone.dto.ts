import { IsString, Matches } from 'class-validator';

export class ChangeUserPhoneDto {
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل نامعتبر است (مثال: 09121234567)' })
  phone!: string;
}
