import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  newPassword!: string;
}

export class AdminUpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'ایمیل نامعتبر است' })
  @MaxLength(200)
  email?: string;

  /** برای تغییر ایمیل الزامی است */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;
}

export const STAFF_TEAMS = ['SUPER_ADMIN', 'SUPPORT', 'BILLING', 'ENGINEERING'] as const;

export class CreateAdminUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsEmail({}, { message: 'ایمیل نامعتبر است' })
  @MaxLength(200)
  email!: string;

  @IsIn(STAFF_TEAMS as unknown as string[])
  team!: (typeof STAFF_TEAMS)[number];
}

export class SetAdminTeamDto {
  @IsIn(STAFF_TEAMS as unknown as string[])
  team!: (typeof STAFF_TEAMS)[number];
}
