# Segue architecture

## Shape

A **modular monolith**: one API process, one data model, five modules (`platform`, `dispense`, `pos`, `office`, `hq`), each made of feature folders (`features/<module>/<feature>/<feature>.routes.ts`). Features talk to each other only through `core/` services or their module's `shared/` folder, so a module can later become its own service without changing its contract. Each module's `index.ts` applies authentication and its licence check once for all its features.

The web app is **Next.js App Router**. `app/` holds only the route tree; screens live in `features/`, matching the API's feature folders. Route groups: `(auth)` for sign-in, `(workspace)` for the signed-in shell. Each workspace segment has a `layout.tsx` that shows the upgrade page when the module is not licensed. Browser requests to `/api/*` are rewritten to the API, so cookies are same-origin.

```
web (Next.js App Router; /api/* rewritten to the API)
  │  httpOnly access + refresh cookies
  ▼
API  rate limit → onRequest: authenticate → loadContext (session, user, roles for current store, licensed modules, permissions)
     preHandler: requireModule(MODULE) → requirePermission(...)
     features/*  ──►  core/ (inventory · store-config · audit · db.tx)  ──►  Prisma
     jobs/worker: HQ sync pass · metric collection · report schedules · PBS schedule
     integrations/: PBS client (live) · registry of on-hold adapters
```

## Authentication

| Piece | Lifetime | Where | Notes |
|---|---|---|---|
| Access token (JWT: sub, tid, sid, ses) | 15 min | httpOnly cookie `segue_at` (path `/`), or `Authorization: Bearer` | Carries the session id; the API re-reads session, user, roles and licences on every request |
| Refresh token | 12 h sliding, within the session | httpOnly `SameSite=Strict` cookie `segue_rt`, path `/api/auth` | Opaque; stored as a SHA-256 hash; single-use; rotated on every refresh (compare-and-set, so parallel refreshes cannot both win) |
| Session | at most 7 days | `Session` table | Revoked on logout, "sign out other devices", password reset, deactivation, or refresh-token reuse |
| Session hint | same as refresh token | httpOnly cookie `segue_signed_in` | Grants nothing; lets `proxy.ts` tell signed-out from access-expired on page loads |

**Reuse detection:** when a refresh token that has already been rotated is presented again, a copy exists somewhere. The session is revoked, which ends both the attacker's and the user's access, and the event is audited.

**Brute force:** failed sign-ins count per account and lock it for `LOCKOUT_MINUTES` after `LOGIN_MAX_ATTEMPTS`. A password reset clears the lock. Unknown emails still run a bcrypt compare, so timing does not reveal which accounts exist.

**Rate limiting** (`core/rate-limit.ts`): a global limit keyed per verified user, falling back to IP; a tighter per-route limit on `/auth/login` (IP + email, evaluated after body parsing) and `/auth/refresh`. The store is in-memory; with more than one API instance, configure Redis.

## Licensing and access

- `Subscription(tenant, module, status, expiresAt)`. A module is usable when ACTIVE/TRIAL and unexpired (`licensedModules`, shared).
- The context is **reloaded from the database on every request**, so a suspension, role change or deactivation applies instantly rather than at token expiry.
- Effective permissions are role permissions filtered to licensed modules (`effectivePermissions`). Platform permissions (users, audit) are never module-gated.
- Roles are scoped per store (`UserRole.storeId`, null = tenant-wide). Store managers cannot grant tenant-wide or HQ roles.
- The Segue vendor console (`/api/vendor`, `isPlatformAdmin`) is the only place subscriptions change, and every change is audited against the tenant.

## Shared model

- **Product** is the single catalogue. Dispensary packs link to the **Drug** master (`drugId`), which holds the clinical and PBS data.
- **StoreProduct** holds per-store stock and an optional store price. The effective price is the store price if set, otherwise the HQ master price.
- **All stock changes go through `moveStock`**, which writes the ledger row and running balance together. Dispense, POS sales, laybys, returns, receiving, adjustments and stocktake all use it.
- **PriceHistory** records every price change with its source.
- Money is integer cents; retail is GST-inclusive.

## Audit

`AuditEvent` rows are SHA-256 hash-chained per tenant, with strictly increasing timestamps. They are written inside the same transaction as the change they describe. `GET /api/platform/audit/verify` recomputes the chain, and a test proves an edited row is detected. Write transactions are serialised in-process (`tx()`), because SQLite is single-writer and this keeps the chain linear. **On PostgreSQL with several API instances, replace this with a per-tenant advisory lock.**

## HQ distribution

```
publish ─► Publication + PublicationTarget per store (QUEUED)
        ─► activate at effectiveAt: central effects (master price, supersede old rule, drug flags);
           stores not yet delivered are pinned to the old price
        ─► worker applies per store when online & active; captures the store's prior state
           (`previous`); offline → retried with exponential backoff (15 s … 15 min), FAILED after 10
rollback ─► restore central state; withdraw undelivered targets; queue a ROLLBACK publication that
           restores each delivered store to its exact captured prior state
```

- A setting takes effect at a store only once its target there is APPLIED (`core/store-config.ts`), which is the same semantics as a remote store agent.
- **Precedence (HQ-SG-04):** the lowest group priority number wins. Ties go to the earliest-created group, then the smaller id. Specificity (drug-class rule) is compared before precedence. Implemented in `shared/domain/precedence.ts` and shown per store in *HQ → Stores → store*.
- **Local overrides (open item):** a store may set its own price in Office. HQ reports it as an inconsistency, and the next HQ publish to that store replaces it.
- **Drug configuration** is written centrally on activation and delivery is tracked per store. Unlike prices, it is not gated per store.

## De-identified reporting

The HQ reads only `StoreDailyMetric` (collected by `jobs/metrics.ts`), store configuration and sale lines. It never reads patient rows. The one exception, the pricing simulation, reads script economics and the concession category, with no identifiers returned.

## Dispensing safety

`runSafetyChecks` evaluates allergies (ingredient or class), interactions against the last 180 days of supplies, duplicate therapy, S8, patient alerts and early repeats. HIGH alerts require an intervention to be recorded at final check. The final check needs a barcode match, or a documented manual verification with mismatches audited. Alerts never hard-block, so professional discretion is preserved. The interaction knowledge base is a small demo set until the MIMS/AMH adapter is licensed.

## PBS

`shared/domain/pbs.ts` centralises the co-payments ($25.00 general from 1 Jan 2026, $7.70 concessional), the safety net thresholds and the $1 discount cap. **These figures must be re-validated with a domain advisor before production.** HQ rules are validated so a PBS rule can never add markup or discount more than $1 (HQ-DP-03). The PBS Data API client (`integrations/pbs`) mirrors the schedule, and only explicit DPMQ fields are mapped: the determined price is not treated as DPMQ.

## Before production

- PostgreSQL in an Australian region (change the Prisma provider), an advisory lock for the audit chain, backups meeting RPO 15 min / RTO 4 h.
- Enterprise IdP with SSO + MFA (HQ-SE-01). Local passwords are a development stand-in. An OIDC callback can call the same `startSession()`, so the token and session layer carries over unchanged.
- Shared rate-limit store (Redis) once the API runs as more than one instance.
- Offline-first store agent: the architecture and sync protocol are in place, but the local store database and replication agent are not built.
- Certified integrations: payment terminal (EFTPOS is simulated with tokenised references), eRx/PDS, MIMS, DD Book, MHR, HI Service.
- Re-validate the PBS, TGA, privacy and state rules; an email adapter to replace the development outbox; 7-year audit retention policy in storage.
