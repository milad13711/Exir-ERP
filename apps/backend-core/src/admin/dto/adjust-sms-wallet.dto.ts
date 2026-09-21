import { IsInt, IsOptional, IsString } from 'class-validator';

/** یا credits (مقدار دقیق) یا delta (افزایش/کاهش) */
export class AdjustSmsWalletDto {
  @IsOptional()
  @IsInt()
  credits?: number;

  @IsOptional()
  @IsInt()
  delta?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
