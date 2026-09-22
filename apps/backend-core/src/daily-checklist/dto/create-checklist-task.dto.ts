import { IsISO8601, IsIn, IsOptional } from 'class-validator';

export class CreateChecklistTaskDto {
  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsIn(['NORMAL', 'MEDIUM', 'URGENT'])
  priority?: 'NORMAL' | 'MEDIUM' | 'URGENT';
}
