import { ArrayMaxSize, IsArray, IsDateString, IsInt, IsNumber, IsObject, IsIn, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class PlatformTicketStatusDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  status!: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

  @IsOptional()
  @IsString()
  resolutionNote?: string;
}

export class PlatformReplyDto {
  @IsString()
  @MinLength(1, { message: 'پیام نمی‌تواند خالی باشد' })
  body!: string;
}

export class PlatformSettingsDto {
  @IsOptional()
  @IsObject()
  ticketAlerts?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  invoiceApproval?: Record<string, unknown>;
}

export class PlatformEditLineDto {
  @IsInt()
  @Min(0)
  index!: number;

  @IsNumber()
  @Min(0)
  amount!: number;
}

export class PlatformEditInvoiceDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  lines?: PlatformEditLineDto[];
}
