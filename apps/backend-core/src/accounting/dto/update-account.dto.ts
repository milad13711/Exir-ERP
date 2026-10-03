import { IsBoolean, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{2,10}$/, { message: 'کد حساب باید فقط شامل عدد باشد' })
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'])
  type?: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

  @IsOptional()
  @IsBoolean()
  isCashAccount?: boolean;
}
