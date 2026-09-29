import { IsBoolean, IsString } from 'class-validator';

export class SetArchiveAccessDto {
  @IsString()
  userId!: string;

  @IsBoolean()
  canEdit!: boolean;
}
