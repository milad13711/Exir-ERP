import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewLeaveDto {
  /** دلیل رد (اختیاری) — به درخواست‌کننده اطلاع داده می‌شود. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
