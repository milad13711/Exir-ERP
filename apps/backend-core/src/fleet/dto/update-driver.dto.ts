import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';

export class UpdateDriverDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone?: string;

  @IsOptional()
  @IsString()
  vehicleType?: string;

  @IsOptional()
  @IsString()
  plateNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  capacityKg?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceAreas?: string[];

  @IsOptional()
  @IsString()
  availableHoursNote?: string;

  @IsOptional()
  @IsString()
  reliabilityNote?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
