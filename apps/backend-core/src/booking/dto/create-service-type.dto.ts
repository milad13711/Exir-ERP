import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateServiceTypeDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsInt()
  @Min(5)
  durationMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
