import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LockPeriodDto, UnlockPeriodDto } from './dto/period-lock.dto.js';

describe('period lock DTOs', () => {
  it('accept short strings / empty body, reject non-strings and >500 chars', async () => {
    expect(await validate(plainToInstance(LockPeriodDto, {}))).toHaveLength(0);
    expect(await validate(plainToInstance(LockPeriodDto, { note: 'ok' }))).toHaveLength(0);
    expect(await validate(plainToInstance(LockPeriodDto, { note: { $x: 1 } }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(UnlockPeriodDto, { reason: 'x'.repeat(501) }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(UnlockPeriodDto, { reason: 123 }))).not.toHaveLength(0);
  });
});
