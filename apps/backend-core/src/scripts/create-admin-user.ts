/**
 * Provisions (or resets the password of) an internal AdminUser — the
 * admin-panel's own login, completely separate from tenant users/OTP.
 * There is no self-registration endpoint for this by design (see
 * AdminAuthController — login only), so a new super-admin/staff account
 * has to be created this way: on the server, inside the backend
 * container (only it can reach the control DB), with the values passed
 * as environment variables so the password never touches a file or this
 * repo.
 *
 * Usage (run once, on the server):
 *   ADMIN_NAME="..." ADMIN_EMAIL="..." ADMIN_PASSWORD="..." [ADMIN_TEAM=SUPER_ADMIN] \
 *     node dist/scripts/create-admin-user.js
 *
 * Idempotent by email: re-running with the same email updates that
 * account's name/team/password instead of failing on a duplicate — the
 * intended way to change an existing admin's password too.
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../../generated/control-client/index.js';

async function main() {
  const name = process.env.ADMIN_NAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const team = (process.env.ADMIN_TEAM ?? 'SUPER_ADMIN') as 'SUPER_ADMIN' | 'SUPPORT' | 'BILLING' | 'ENGINEERING';

  if (!name || !email || !password) {
    console.error('ADMIN_NAME, ADMIN_EMAIL و ADMIN_PASSWORD الزامی‌اند.');
    process.exit(1);
  }

  const db = new PrismaClient({ datasources: { db: { url: process.env.CONTROL_DATABASE_URL } } });
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await db.adminUser.upsert({
      where: { email },
      create: { name, email, passwordHash, team, isActive: true },
      update: { name, passwordHash, team, isActive: true },
    });
    console.log(`OK: ${admin.email} (${admin.team}) — id ${admin.id}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('create-admin-user failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
