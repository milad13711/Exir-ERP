import { IsArray, IsString } from 'class-validator';

export class UpdateNavOrderDto {
  @IsArray()
  @IsString({ each: true })
  order!: string[];
}
