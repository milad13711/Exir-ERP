import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

class UpdateActionDto {
  @IsIn(['NOTIFY_IN_APP', 'SEND_SMS', 'CREATE_TASK'])
  type!: 'NOTIFY_IN_APP' | 'SEND_SMS' | 'CREATE_TASK';

  @IsObject()
  config!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  sequenceOrder?: number;
}

export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  triggerCode?: string;

  /** اگر بیاید، کل اقدام‌های قانون با این فهرست جایگزین می‌شود. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateActionDto)
  actions?: UpdateActionDto[];
}
