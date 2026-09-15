import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @ValidateIf((o) => o.email !== null)
  @IsString()
  email?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.avatarUrl !== null)
  @IsString()
  avatarUrl?: string | null;
}
