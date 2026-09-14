import { IsInt, IsISO8601, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateCertificateDto {
  @IsString()
  employeeId!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  recipientNameFa?: string; // خالی یعنی از نام کارمند استفاده شود

  @IsOptional()
  @IsString()
  recipientNameEn?: string;

  @IsString()
  @MinLength(2)
  courseTitleFa!: string;

  @IsOptional()
  @IsString()
  courseTitleEn?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationHours?: number;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;
}
