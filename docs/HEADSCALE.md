# Remote access into on-premise tenant servers (Headscale)

Exir staff sometimes need to reach a customer's on-premise Exir ERP server —
to push an update, debug an issue, or check on the deployment — without that
server having any inbound port open to the public internet. This is solved
with a private mesh network (WireGuard, via [Headscale](https://headscale.net/)),
not a VPN we depend on a third party for.

## Why Headscale, not Tailscale's own hosted service

Tailscale's client and protocol are what we use, but its *coordination
server* (the thing that authenticates devices and hands out mesh IPs) is
normally Tailscale-the-company's own hosted service. We deliberately don't
use that here: our tenants are Iran-based, and depending on a foreign
company's cloud service for security-critical access into a customer's
private network is a real risk given the network filtering already observed
in this project's history — if that service becomes unreachable or blocks
accounts tied to Iran, we lose remote access to every customer at once, at
the worst possible time.

**Headscale** re-implements the same coordination-server protocol as an
open-source, self-hostable service. Tailscale's own client software works
against it unmodified — we get the same connectivity quality (NAT traversal,
DERP relay fallback) — but *we* run and control the coordination server, on
infrastructure we already own.

## Current setup

- Headscale runs at `/opt/headscale` on `45.94.215.22`, as its own
  `docker-compose.yml` — independent of the app's own
  `docker-compose.on-premise.yml` (different lifecycle; an app deploy never
  touches this).
- Control API: `http://45.94.215.22:8083` (plain HTTP, consistent with this
  box's other internal-only tools — admin-panel and marketing-site are also
  unencrypted on their own ports today; putting this behind a real domain +
  TLS is a reasonable follow-up, blocked on DNS/panel access same as the
  `app.eta.co.ir` migration).
- Two Headscale "users" (namespaces): `exir-staff` (our own devices — a
  laptop, or this same production server acting as a jump point) and
  `exir-tenants` (on-premise customer servers). Kept separate so an ACL
  policy can restrict tenant nodes to only be reachable *from* staff nodes,
  never from each other.
- Source of truth for the config: `infra/headscale/config.yaml`,
  `infra/headscale/policy.hujson`, and `infra/headscale/docker-compose.yml`
  in this repo — the copies on the server should be kept in sync with these
  if any of them change.

## ACL policy (tenant isolation)

`infra/headscale/policy.hujson` is loaded into Headscale's database (`policy.mode: database`
in `config.yaml`) via:
```bash
docker cp infra/headscale/policy.hujson headscale:/etc/headscale/policy.hujson
docker exec headscale headscale policy set -f /etc/headscale/policy.hujson
```
Re-run this any time `policy.hujson` changes — it isn't watched automatically.

The policy allows `exir-staff` to reach `exir-tenants` (any port) and other
`exir-staff` nodes, and deliberately contains **no rule with `exir-tenants` as
a source**. Once any ACL policy is active, Headscale's default "nodes under
the same user can always reach each other" behavior is gone entirely —
everything not explicitly allowed is denied. Verified live with three
throwaway nodes (one staff, two tenants, each in its own isolated docker
network so they could only reach each other through the mesh):
- `exir-staff → exir-tenants`: works.
- `exir-tenants → another exir-tenants node`: **"no matching peer"** — the
  other tenant isn't even visible in its netmap. This is the isolation that
  actually matters (one customer's server can never see or reach another's).
- `exir-tenants → exir-staff`: unexpectedly **also succeeds**. This is a
  property of how Tailscale/Headscale ACLs work, not a mistake in the policy:
  a rule connecting two users makes them mesh *peers*, and once peered,
  traffic flows both ways on the allowed ports — ACLs express "who peers with
  whom," not a one-directional firewall rule. There's no way to make a peer
  link strictly one-directional in this policy model. This is an accepted
  trade-off, not a fixed gap: the actual risk we set out to close (tenant ↔
  tenant) is fully closed; a tenant being able to reach back toward our own
  staff devices is a smaller, different risk we'd address by hardening the
  staff devices themselves rather than by policy.

## Enabling remote access for a specific on-premise deployment

1. Issue a pre-auth key for that tenant (on the Headscale host):
   ```bash
   docker exec headscale headscale preauthkeys create --user exir-tenants --expiration 24h --reusable=false
   ```
   (Use a short expiration — it's a one-time bootstrap secret, not a
   long-lived credential. The node's own machine key, issued after it first
   registers, is what persists.)
2. Hand the customer (or set directly, if we manage the box) `TS_AUTHKEY` in
   their on-premise `.env` to that key.
3. Start the optional tunnel sidecar alongside their normal stack:
   ```bash
   docker compose -f docker-compose.on-premise.yml --profile remote-access up -d tailscale
   ```
4. Confirm it registered: `docker exec headscale headscale nodes list` on the
   Headscale host should show it as `online`.
5. From a staff device also joined to `exir-staff`, reach it directly over
   its `100.64.x.x` mesh IP — e.g. `ssh root@100.64.x.x` — no inbound port on
   their side was ever opened.

## Joining a staff device (e.g. your own laptop, for on-call access)

```bash
docker exec headscale headscale preauthkeys create --user exir-staff --expiration 1h --reusable=false
tailscale up --login-server=http://45.94.215.22:8083 --authkey=<the key above>
```

## Operational notes

- Node/user management, and read access to `headscale nodes list`, requires
  SSH access to `45.94.215.22` today — there's no admin-panel UI for this
  yet. A natural follow-up (not built yet) is surfacing "which tenant nodes
  are online" in admin-panel next to the license connectivity monitoring
  already there, ideally via Headscale's gRPC API rather than shelling out.
- The DERP relay used for NAT-traversal assist (see `derp.urls` in
  `config.yaml`) is still Tailscale's own public relay map. This is a much
  smaller dependency than the coordination server — a DERP node only relays
  *already-encrypted* WireGuard packets and can't decrypt or authenticate
  anything — but if that also becomes a concern later, self-hosting a
  `derper` instance is the documented next step.
