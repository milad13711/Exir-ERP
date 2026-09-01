import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

const DIRECTIONS = ['RECEIVED', 'ISSUED'] as const;

export class CreateCheckDto {
  @IsIn(DIRECTIONS)
  direction!: (typeof DIRECTIONS)[number];

  @IsString()
  @MinLength(1)
  sayadId!: string;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsISO8601()
  dueDate!: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  reminderDaysBefore?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
