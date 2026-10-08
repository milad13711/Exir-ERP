import { Type } from 'class-transformer';
import { IsHttpUrl } from '../../common/validators/is-http-url.js';
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, Matches, Min, MinLength, ValidateNested } from 'class-validator';
import { CreateTicketTypeDto } from './create-ticket-type.dto.js';

export class CreateEventDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'شناسه‌ی عمومی فقط می‌تواند شامل حروف انگلیسی کوچک، عدد و خط تیره باشد' })
  slug!: string;

  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsString()
  venue?: string;

  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @IsOptional()
  @IsString()
  @IsHttpUrl()
  onlineUrl?: string;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsOptional()
  @IsDateString()
  registrationOpensAt?: string;

  @IsOptional()
  @IsDateString()
  registrationClosesAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTicketTypeDto)
  ticketTypes!: CreateTicketTypeDto[];
}
