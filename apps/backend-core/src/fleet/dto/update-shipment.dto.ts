import { IsDateString, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

/** ویرایش بار — فقط پیش‌نویس (هنوز پیشنهادی به راننده‌ای ارسال نشده). */
export class UpdateShipmentDto {
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  cargoType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsDateString()
  pickupAt?: string;
}
