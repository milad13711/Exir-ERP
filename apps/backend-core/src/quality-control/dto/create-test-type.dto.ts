import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTestTypeDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  unit!: string;

  @IsOptional()
  @IsNumber()
  acceptableMin?: number;

  @IsOptional()
  @IsNumber()
  acceptableMax?: number;

  @IsOptional()
  @IsString()
  description?: string;
}
