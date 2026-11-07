import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateSampleDto {
  @IsOptional()
  @IsIn(['IN_PROCESS', 'FINAL_PRODUCT'])
  source?: 'IN_PROCESS' | 'FINAL_PRODUCT';

  @IsOptional()
  @IsString()
  note?: string;
}
