import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class HireApplicantDto {
  /** خالی یعنی شماره‌ی پرسنلی خودکار بر اساس آخرین شماره‌ی صادرشده. */
  @IsOptional()
  @IsString()
  employeeCode?: string;

  /** واحد فعالیت — از واحدهای تعریف‌شده‌ی منابع انسانی. */
  @IsOptional()
  @IsString()
  departmentId?: string;

  /** «تأیید و اجازه‌ی درج مهر و امضا» */
  @IsOptional()
  @IsBoolean()
  applyStamp?: boolean;

  @IsOptional()
  @IsBoolean()
  createLogin?: boolean;

  @IsOptional()
  @IsString()
  roleId?: string;
}
