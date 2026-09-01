import { IsUUID } from 'class-validator';

export class MatchStatementLineDto {
  @IsUUID()
  statementLineId!: string;

  @IsUUID()
  journalLineId!: string;
}
