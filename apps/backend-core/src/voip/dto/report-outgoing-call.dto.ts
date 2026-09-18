import { IsOptional, IsString, MinLength } from 'class-validator';

export class ReportOutgoingCallDto {
  @IsString()
  @MinLength(1)
  toNumber!: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  sipCallId?: string;
}
