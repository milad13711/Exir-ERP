import { IsString, MinLength } from 'class-validator';

export class SubscribePushDto {
  @IsString()
  @MinLength(1)
  endpoint!: string;

  @IsString()
  @MinLength(1)
  p256dh!: string;

  @IsString()
  @MinLength(1)
  auth!: string;
}
