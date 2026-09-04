import { IsString, MinLength } from 'class-validator';

export class AddStageDto {
  @IsString()
  @MinLength(1)
  title!: string;
}
