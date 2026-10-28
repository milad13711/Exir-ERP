import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;

export class CreateBankAccountDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(80) bankName?: string;
  @IsOptional() @IsString() @MaxLength(120) branch?: string;
  @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) sheba?: string;
  @IsOptional() @IsString() @MaxLength(25) cardNumber?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3,4}$/) currency?: string;
  /** تومان؛ منفی = مانده‌ی بدهکاری (اضافه‌برداشت) */
  @IsOptional() @IsInt() @Min(-MAX_AMOUNT) @Max(MAX_AMOUNT) openingBalance?: number;
  @IsOptional() @IsISO8601() openingDate?: string;
  @IsOptional() @IsUUID() linkedAccountId?: string;
}

export class UpdateBankAccountDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(80) bankName?: string;
  @IsOptional() @IsString() @MaxLength(120) branch?: string;
  @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) sheba?: string;
  @IsOptional() @IsString() @MaxLength(25) cardNumber?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateCashBoxDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsUUID() custodianUserId?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_AMOUNT) openingBalance?: number;
  @IsOptional() @IsISO8601() openingDate?: string;
  @IsOptional() @IsUUID() linkedAccountId?: string;
}

export class UpdateCashBoxDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsUUID() custodianUserId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateChequeBookDto {
  @IsUUID() bankAccountId!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(20) series?: string;
  @IsInt() @Min(1) @Max(2_000_000_000) startSerial!: number;
  @IsInt() @Min(1) @Max(2_000_000_000) endSerial!: number;
  @IsOptional() @IsInt() @Min(1) @Max(500) leafCount?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateChequeBookDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsIn(['ACTIVE', 'CLOSED']) status?: 'ACTIVE' | 'CLOSED';
}

export class SetLeafStatusDto {
  @IsIn(['UNUSED', 'VOID', 'LOST']) status!: 'UNUSED' | 'VOID' | 'LOST';
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class CreateBankTransactionDto {
  @IsIn(['RECEIPT', 'PAYMENT', 'TRANSFER']) type!: 'RECEIPT' | 'PAYMENT' | 'TRANSFER';
  @IsISO8601() date!: string;
  @IsInt() @Min(1) @Max(MAX_AMOUNT) amount!: number;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(80) referenceNo?: string;
  @IsOptional() @IsUUID() bankAccountId?: string;
  @IsOptional() @IsUUID() cashBoxId?: string;
  @IsOptional() @IsUUID() toBankAccountId?: string;
  @IsOptional() @IsUUID() toCashBoxId?: string;
  @IsOptional() @IsUUID() counterAccountId?: string;
  @IsOptional() @IsUUID() contactId?: string;
}

export class VoidBankTransactionDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}
