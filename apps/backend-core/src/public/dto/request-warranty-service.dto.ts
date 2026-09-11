import { IsOptional, IsString, MinLength } from 'class-validator';

export class RequestWarrantyServiceDto {
  @IsString()
  code!: string;

  @IsString()
  @MinLength(5)
  description!: string;

  @IsOptional()
  @IsString()
  photo?: string;
}
