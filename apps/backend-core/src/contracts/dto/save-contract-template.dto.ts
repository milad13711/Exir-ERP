import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class SaveContractTemplateDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsIn(['INTERNAL', 'EXTERNAL', 'THIRD_PARTY'])
  partyMode!: 'INTERNAL' | 'EXTERNAL' | 'THIRD_PARTY';

  @IsOptional()
  @IsIn(['SALES', 'PURCHASE'])
  type?: 'SALES' | 'PURCHASE';

  @IsString()
  @MinLength(2)
  body!: string;
}
