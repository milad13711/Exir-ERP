import { IsString } from 'class-validator';

export class FireTriggerDto {
  @IsString()
  triggerCode!: string;

  @IsString()
  entityId!: string;
}
