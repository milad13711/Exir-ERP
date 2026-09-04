import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateContractDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsIn(['SALES', 'PURCHASE'])
  type!: 'SALES' | 'PURCHASE';

  @IsString()
  contactId!: string;

  @IsInt()
  @Min(0)
  value!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  renewalReminderDays?: number;

  @IsOptional()
  @IsString()
  terms?: string;
}
