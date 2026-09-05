import { IsOptional, IsString } from 'class-validator';

export class AssignStageDto {
  @IsOptional()
  @IsString()
  responsibleUserId?: string;
}
