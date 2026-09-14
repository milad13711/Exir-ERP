import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateApplicantDto {
  @IsString()
  jobPostingId!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(10)
  phone!: string;

  @IsOptional()
  @IsString()
  educationField?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skillTags?: string[];

  @IsOptional()
  @IsString()
  resumeFile?: string;
}
