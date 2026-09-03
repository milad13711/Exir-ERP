import { IsOptional, IsString } from 'class-validator';

export class ApproveRawMaterialDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
