import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateSmsPackageDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  priceToman?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
