import { IsString } from 'class-validator';

export class AssignTicketDto {
  @IsString()
  adminUserId!: string;
}
