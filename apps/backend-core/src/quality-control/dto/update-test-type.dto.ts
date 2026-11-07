import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateTestTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  acceptableMin?: number | null;

  @IsOptional()
  @IsNumber()
  acceptableMax?: number | null;

  @IsOptional()
  @IsString()
  description?: string;
}
