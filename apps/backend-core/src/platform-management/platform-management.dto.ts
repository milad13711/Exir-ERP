import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

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
