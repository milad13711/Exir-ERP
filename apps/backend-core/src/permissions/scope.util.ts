import { NotFoundException } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FindFirstDelegate = { findFirst: (args: any) => Promise<unknown> };

/**
 * Ownership guard for by-id mutation / sub-resource routes. A user with only
 * "view own" on a module must not be able to act on another user's record by
 * guessing an id. `scope` is the fragment returned by `PermissionsService.viewScope`
 * (or a module-local equivalent); an empty scope means view-all (managers) so no
 * extra query is issued. Otherwise the record is re-resolved through the scope and
 * a 404 is thrown when it is out of scope — indistinguishable from "does not exist".
 *
 * `where` is the record's own identity filter (e.g. `{ id }`) — the scope is merged
 * in by the caller-supplied `wrap`, which defaults to a plain spread; for child
 * resources pass a `wrap` that nests the scope under the parent relation.
 */
export async function assertInScope(
  delegate: FindFirstDelegate,
  scope: Record<string, unknown>,
  where: Record<string, unknown>,
  options: { wrap?: (scope: Record<string, unknown>) => Record<string, unknown>; message?: string } = {},
): Promise<void> {
  if (Object.keys(scope).length === 0) return;
  const scoped = options.wrap ? options.wrap(scope) : scope;
  const row = await delegate.findFirst({ where: { ...where, ...scoped }, select: { id: true } });
  if (!row) throw new NotFoundException(options.message ?? 'رکورد یافت نشد');
}
