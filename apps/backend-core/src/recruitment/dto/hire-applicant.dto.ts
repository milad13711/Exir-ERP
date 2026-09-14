import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class HireApplicantDto {
  @IsString()
  @MinLength(1)
  employeeCode!: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsBoolean()
  createLogin?: boolean;

  @IsOptional()
  @IsString()
  roleId?: string;
}
