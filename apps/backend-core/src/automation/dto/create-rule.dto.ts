import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

class ActionInputDto {
  @IsIn(['NOTIFY_IN_APP', 'SEND_SMS', 'CREATE_TASK'])
  type!: 'NOTIFY_IN_APP' | 'SEND_SMS' | 'CREATE_TASK';

  @IsObject()
  config!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  sequenceOrder?: number;
}

export class CreateRuleDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  triggerCode!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ActionInputDto)
  actions!: ActionInputDto[];
}
