import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  done?: boolean;

  /** تغییر اولویت هم لیست را بلافاصله دوباره مرتب می‌کند (فوری بالای همه). */
  @IsOptional()
  @IsIn(['URGENT', 'MEDIUM', 'NORMAL'])
  priority?: 'URGENT' | 'MEDIUM' | 'NORMAL';
}
