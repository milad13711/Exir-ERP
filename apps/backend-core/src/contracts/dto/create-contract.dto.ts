import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateContractDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsIn(['INTERNAL', 'EXTERNAL', 'THIRD_PARTY'])
  partyMode!: 'INTERNAL' | 'EXTERNAL' | 'THIRD_PARTY';

  @IsOptional()
  @IsIn(['SALES', 'PURCHASE'])
  type?: 'SALES' | 'PURCHASE';

  @IsOptional()
  @IsIn(['NOTARIZED', 'LAWYER_SUPERVISED', 'GENERAL'])
  legalCategory?: 'NOTARIZED' | 'LAWYER_SUPERVISED' | 'GENERAL';

  @IsOptional()
  @IsString()
  templateId?: string;

  // طرف اول — برای INTERNAL شناسه‌ی پرسنل، برای EXTERNAL/THIRD_PARTY شناسه‌ی مخاطب CRM
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  // طرف دوم — فقط برای THIRD_PARTY
  @IsOptional()
  @IsString()
  secondPartyContactId?: string;

  @IsOptional()
  @IsString()
  secondPartyName?: string;

  @IsOptional()
  @IsString()
  secondPartyPhone?: string;

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
