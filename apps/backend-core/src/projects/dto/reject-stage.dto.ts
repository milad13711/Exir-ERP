import { IsOptional, IsString } from 'class-validator';

export class RejectStageDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
