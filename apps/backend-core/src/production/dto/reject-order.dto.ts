import { IsString, MinLength } from 'class-validator';

export class RejectOrderDto {
  @IsString()
  @MinLength(2)
  reason!: string;
}
