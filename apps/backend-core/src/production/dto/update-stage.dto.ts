import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateStageDto {
  @IsOptional()
  @IsIn(['PENDING', 'IN_PROGRESS', 'DONE'])
  status?: 'PENDING' | 'IN_PROGRESS' | 'DONE';

  @IsOptional()
  @IsString()
  report?: string;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;
}
