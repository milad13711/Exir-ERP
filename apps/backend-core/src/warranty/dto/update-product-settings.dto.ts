import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateProductWarrantySettingsDto {
  @IsBoolean()
  warrantyEnabled!: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  warrantyDurationDays?: number;
}
