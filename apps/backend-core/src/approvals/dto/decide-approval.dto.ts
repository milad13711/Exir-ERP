import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DecideApprovalDto {
  @IsBoolean()
  approved!: boolean;

  /** «تأیید و اجازه‌ی درج مهر و امضا» — فقط برای اسناد رسمی. */
  @IsOptional()
  @IsBoolean()
  withStamp?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
