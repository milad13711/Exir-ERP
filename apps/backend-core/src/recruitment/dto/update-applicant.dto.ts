import { IsArray, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateApplicantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  phone?: string;

  @IsOptional()
  @IsString()
  educationField?: string;

  @IsOptional()
  @IsISO8601()
  birthDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skillTags?: string[];

  @IsOptional()
  @IsString()
  resumeFile?: string;
}
