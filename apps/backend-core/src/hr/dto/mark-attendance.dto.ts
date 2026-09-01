import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class MarkAttendanceDto {
  @IsUUID()
  employeeId!: string;

  @IsISO8601()
  date!: string;

  @IsIn(['PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY'])
  status!: 'PRESENT' | 'ABSENT' | 'LEAVE' | 'HOLIDAY';

  @IsOptional()
  @IsISO8601()
  checkIn?: string;

  @IsOptional()
  @IsISO8601()
  checkOut?: string;
}
