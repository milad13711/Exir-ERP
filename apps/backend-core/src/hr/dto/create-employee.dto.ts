import { IsEmail, IsISO8601, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  employeeCode!: string;

  @IsString()
  @MinLength(2)
  fullName!: string;

  @IsString()
  @MinLength(2)
  position!: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  nationalId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsISO8601()
  hireDate!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  baseSalary?: number;

  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}
