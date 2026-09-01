import { IsString, MinLength } from 'class-validator';

export class AddMessageDto {
  @IsString()
  @MinLength(1, { message: 'پیام نمی‌تواند خالی باشد' })
  body!: string;
}
