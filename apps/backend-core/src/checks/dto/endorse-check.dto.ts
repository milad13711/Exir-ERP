import { IsUUID } from 'class-validator';

export class EndorseCheckDto {
  @IsUUID()
  toContactId!: string;
}
