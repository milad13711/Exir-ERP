import { IsOptional, IsString } from 'class-validator';

export class GrantEmployeeAccessDto {
  @IsString()
  roleId!: string;

  /** خالی یعنی از شماره‌ی ثبت‌شده‌ی پرسنل استفاده شود. */
  @IsOptional()
  @IsString()
  phone?: string;
}
