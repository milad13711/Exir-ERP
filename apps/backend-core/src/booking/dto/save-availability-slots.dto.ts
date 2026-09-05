import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Max, Min, ValidateNested } from 'class-validator';

class AvailabilitySlotItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @IsInt()
  @Min(0)
  startMinute!: number;

  @IsInt()
  @Max(24 * 60)
  endMinute!: number;
}

export class SaveAvailabilitySlotsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotItemDto)
  slots!: AvailabilitySlotItemDto[];
}
