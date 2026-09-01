import { IsString, MinLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MinLength(3, { message: 'موضوع تیکت را وارد کنید' })
  subject!: string;

  @IsString()
  @MinLength(1, { message: 'پیام نمی‌تواند خالی باشد' })
  message!: string;
}
