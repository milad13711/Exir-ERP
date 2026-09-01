import { IsIn, IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateLeaveRequestDto {
  @IsUUID()
  employeeId!: string;

  @IsIn(['ANNUAL', 'SICK', 'UNPAID'])
  type!: 'ANNUAL' | 'SICK' | 'UNPAID';

  @IsISO8601()
  startDate!: string;

  @IsISO8601()
  endDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
