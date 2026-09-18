import { IsOptional, IsString } from 'class-validator';

export class UpdateStampDelegateDto {
  /** خالی/نبود یعنی حذف ارجاع — دسترسی امضا فقط برای خودِ مالک باقی می‌ماند. */
  @IsOptional()
  @IsString()
  userId?: string | null;
}
