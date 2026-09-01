# Exir ERP — Backend Core

NestJS backend implementing the SaaS control plane and the database-per-tenant
multi-tenant architecture described in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

## Two databases, two Prisma schemas

- **`prisma/control/schema.prisma`** — one shared "Control Plane" database:
  tenant directory, plans/subscriptions/invoices, the module marketplace
  catalog, internal staff accounts (the management team), and cross-tenant
  support tickets + the central audit/error log.
- **`prisma/tenant/schema.prisma`** — the template applied, as-is, to a
  **fresh, isolated Postgres database created for every tenant**: users,
  roles/permissions, tasks/reminders, tenant-scoped activity/error logs, and
  per-module settings. No tenant ever queries another tenant's data — they
  are physically different databases.

`TenantsService.createTenant()` is the one place that does end-to-end
onboarding: allocate the database, run `prisma migrate deploy` against it,
seed default roles, create the owner's membership, start their trial
subscription — and rolls the Tenant row back to inspectable
`PENDING_PROVISION` (never silently `ACTIVE`) if any step fails.

## Local development

A project-local Postgres cluster lives in `infra/postgres/` (port 5433) —
it does **not** touch any system-wide Postgres install:

```bash
../../infra/postgres/start.sh   # start the dev cluster
npm run prisma:control:migrate  # apply control-plane migrations
npm run seed                    # plans, module catalog, super-admin + support staff
npm run start:dev
```

Demo credentials after `npm run seed`:

| Role | Login |
|---|---|
| Super admin (management backoffice) | `admin@exir.co` / `ExirAdmin123!` |
| Support staff | `support@exir.co` / `ExirSupport123!` |

OTP codes are **echoed in the API response** in dev (`OTP_DEV_ECHO=true`) —
no SMS provider is wired up yet, so there's nothing to configure to test the
login flow end-to-end.

### Creating a demo tenant

Tenant onboarding goes through the real admin API — the same path
production onboarding uses:

```bash
TOKEN=$(curl -s -X POST localhost:3001/api/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@exir.co","password":"ExirAdmin123!"}' | jq -r .accessToken)

curl -X POST localhost:3001/api/admin/tenants -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"شرکت اکسیر نمونه","slug":"exir-demo","ownerPhone":"09121234567","ownerName":"سارا محمدی","planCode":"professional"}'
```

Then the owner logs in normally: `POST /api/auth/otp/request` →
`POST /api/auth/otp/verify` with `tenantSlug: "exir-demo"`.

## Identity model

- **Tenant users** authenticate with phone + OTP. A `GlobalUser` (control
  plane) is one person across every tenant they belong to; a
  `TenantMembership` row is the coarse OWNER/ADMIN/MEMBER role that gates
  which tenant a login token is scoped to. Fine-grained, module-aware
  permissions (`Role`/`Permission` — "مدیر سیستم", "کارشناس فروش", ...) live
  inside that tenant's own database, since they depend on which modules the
  tenant has installed.
- **Internal staff** (`AdminUser` — the management team: SUPER_ADMIN,
  SUPPORT, BILLING, ENGINEERING) authenticate with email + password and are
  a completely separate identity space — an AdminUser can never sign in as a
  tenant, and vice versa. `/admin/*` routes are the management team's
  control surface: onboard/suspend tenants, triage and resolve support
  tickets, read the audit and error log. Every admin action writes an
  `AuditLog` row.

## Support ticket → task handoff

`POST /support/tickets` (tenant side) opens a ticket. On the management
side, `POST /admin/support/tickets/:id/assign` is the "convert to task and
hand off to a specialist" step (ticket status → `IN_PROGRESS`, an
`assignedAdminId` is set); `POST /admin/support/tickets/:id/resolve` closes
the loop with a `resolutionNote` the tenant can see in the thread.

## Error visibility

Every 5xx response passes through `AllExceptionsFilter`, which writes it to
the central `ErrorLog` table (`GET /admin/logs/errors`) before responding —
so the management team sees a failure the moment it happens, with the
tenant it occurred in and the full stack trace.
