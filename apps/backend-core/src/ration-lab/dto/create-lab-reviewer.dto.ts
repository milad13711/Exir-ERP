import { IsOptional, IsString } from 'class-validator';

export class CreateLabReviewerDto {
  @IsString()
  phone!: string;

  @IsString()
  name!: string;
}

export class UpdateLabReviewerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  isActive?: boolean;
}
