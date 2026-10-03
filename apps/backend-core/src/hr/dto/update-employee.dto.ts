import { IsEmail, IsISO8601, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

/** فیلدهای اختیاری با null پاک می‌شوند؛ undefined یعنی بدون تغییر. */
export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  employeeCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  position?: string;

  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsString()
  nationalId?: string | null;

  @IsOptional()
  @IsISO8601()
  birthDate?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsISO8601()
  hireDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  baseSalary?: number;
}
