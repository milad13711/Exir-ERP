import { IsEmail, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreatePublicLeadDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsString()
  @MinLength(10)
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedValue?: number;

  @IsOptional()
  @IsString()
  configurationSummary?: string;
}
