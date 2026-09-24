# Segue — Pharmacy Management System

One connected platform for Australian community pharmacy, sold as four modules:

| Module | For | Covers |
|---|---|---|
| **Segue Dispense** | Pharmacists, technicians | eRx tokens / ASL, patients, prescribers, ranked medicine selection, allergy / interaction / duplicate-therapy checks, PBS co-payment and safety net pricing, final check with barcode scan, labels, repeats, script audit, reports |
| **Segue POS** | Cashiers, assistants | Touch register with hot keys, script pickup from Dispense, promotions, margin protection, split tenders, PBS-exempt card surcharging, receipts, returns, laybys, equipment hire, X / Z / ZZ balancing |
| **Segue Office** | Store managers | Products, real-time inventory and movement ledger, reorder suggestions, suppliers, purchase orders → goods receiving, pricing review, customer accounts and statements, stocktake, store reports |
| **Segue HQ** | Head office | Stores and groups with deterministic precedence, central dispense pricing (PBS-validated, simulated, schedulable), drug ranking and flags, retail pricing and inconsistency report, promotions, supplier price files, publish → queue → retry → rollback, de-identified group reporting with CSV/PDF and scheduled email |

**Licensing is enforced by the API.** A tenant holds a subscription per module. Every `/api/<module>` route checks it on every request (`requireModule`), and a user's effective permissions are *role permissions ∩ licensed modules*. The UI mirrors this with locked workspaces, but it is not the enforcement point.

## Quick start

Requires Node 20+.

```bash
npm run setup
```

```bash
npm run dev
```

- Web (Next.js): http://localhost:5173 · API: http://localhost:4000. The web app proxies `/api/*` to the API, so the browser only talks to one origin.
- `setup` installs dependencies, creates the SQLite database and loads demo data. To wipe and reload demo data later, run `npm run db:reset -w @segue/api` yourself; Prisma blocks destructive resets initiated by AI agents.

### Demo accounts (password `Segue2026!`)

| Email | What you'll see |
|---|---|
| `owner@harbourside.demo` | Everything: 5 stores, all four modules |
| `pharmacist@harbourside.demo` | Dispense + POS selling at Sydney CBD |
| `tech@harbourside.demo` | Prepares scripts; cannot final-check |
| `cashier@harbourside.demo` | POS only, no clinical data |
| `manager@harbourside.demo` | Office + POS management |
| `pricing@harbourside.demo` | HQ pricing, promotions, price files |
| `reports@harbourside.demo` | HQ read-only |
| `owner@cornerchemist.demo` | Single store: Dispense + POS licensed, **Office expired, HQ not purchased** |
| `vendor@segue.demo` | Segue licensing console — turn modules on/off per organisation |

Try these:
- **eRx token `2GF7K9QXLM4T`**: warfarin patient prescribed aspirin → HIGH interaction → intervention required at final check.
- **eRx token `3HD8P2WZRN6V`**: penicillin allergy.
- **HQ → Stores**: toggle Newcastle's agent online to watch queued deliveries apply. Then roll back a publication in *Publishing & sync*.
- **Vendor console**: suspend a module for Corner Chemist, and that tenant is locked out immediately.

## Repository layout

```
packages/shared/            Domain rules shared by API and web — PBS, pricing, precedence, safety,
                            ranking, POS totals, price files, RBAC, licensing (with unit tests)

apps/api/src/
  core/                     Cross-cutting infrastructure
    auth/                   context (per-request user/licence/session), guards, tokens (access/refresh)
    rate-limit.ts  audit.ts  inventory.ts  store-config.ts  db.ts  errors.ts
  features/                 One folder per feature; each module's index.ts enforces its licence once
    platform/  auth · users · audit · licence · catalogue · integrations · vendor
    dispense/  dashboard · patients · prescribers · medicines · erx · scripts · reports · shared
    pos/       shifts · catalogue · sales · customers · laybys · hire · shared
    office/    dashboard · products · inventory · suppliers · purchasing · pricing · accounts · stocktake · reports
    hq/        dashboard · stores · dispense-pricing · drug-config · retail-pricing · promotions ·
               price-files · sync · reports · catalogue · shared
  integrations/pbs/         PBS Data API client + schedule mirror
  jobs/                     Sync worker, store metric collection, report schedules

apps/web/src/               Next.js 16 App Router
  app/                      Routes only: layouts, pages, error / loading / not-found
    (auth)/login/           Sign-in
    (workspace)/            Signed-in shell; dispense/ pos/ office/ hq/ each have a layout.tsx licence gate
  features/                 One folder per feature (client components), mirroring the API features
    auth/  launcher/  dispense/  pos/  office/  hq/  admin/  shared/
  components/               UI kit and app shell
  lib/                      API client (with token refresh), formatting, navigation helpers
  proxy.ts                  Server-side redirect to /login for signed-out visitors
```

## Authentication & rate limiting

- **Access token**: a JWT valid for 15 minutes, sent in an httpOnly cookie. Non-browser clients can send it as `Authorization: Bearer` instead.
- **Refresh token**: random and single-use, stored only as a SHA-256 hash. Its cookie is scoped to `/api/auth`. Every refresh rotates it. If a used token is presented again, it was copied, so the whole session is revoked.
- **Sessions**: each signed-in device is a session that expires after at most 7 days. The API checks the session on every request, so sign-out, password reset and deactivation cut access off immediately. Users can see and sign out their devices under *Administration → My sessions*.
- **Client refresh**: the web client refreshes transparently on a 401 and retries the request. The refresh is single-flight, so concurrent requests share one refresh.
- **Lockout**: an account locks for 15 minutes after 5 failed sign-ins.
- **Rate limits**:
  - General API: 300 requests per minute per signed-in user (per IP when signed out).
  - Sign-in: 10 attempts per 15 minutes per IP + email.
  - Refresh: 60 per 15 minutes per IP.
  - 429 responses carry `retry-after`, and every response has `x-ratelimit-*` headers.
- All values are configurable in `apps/api/.env` (see `.env.example`).

## Quality

```bash
npm test
```

```bash
npm run typecheck
```

- `packages/shared`: 26 unit tests covering PBS co-payment and safety net, rule precedence, PBS limit validation, safety checks, ranking, surcharge, tenders and price files.
- `apps/api`: 29 integration tests, including token rotation and reuse detection, logout revocation, Bearer tokens, expired-token handling, lockout and rate limiting, plus 18 tests against a fresh throwaway database: licence enforcement and live licence changes, RBAC and privilege escalation, eRx dispense with an interaction intervention, scan mismatch, stock and audit, mixed-cart sale with PBS-exempt surcharge, below-cost override, HQ publish / offline queue / exact rollback, PBS rule validation, audit tamper detection, and the PBS API client.

## Integrations

| Integration | Status |
|---|---|
| **PBS Data API v3** | Implemented. Set `PBS_API_KEY` in `apps/api/.env` (free key from data-api-portal.health.gov.au). The schedule is mirrored locally with rate-limit-aware background sync; dispensing never depends on the live API. Without a key, the seeded drug master is used. |
| eRx / PDS, ASL, MIMS/AMH, DD Book, MethDA, My Health Record, HI Service, PBS Embargo | **On hold** pending credentials (PRODA, NASH/HI certificates, vendor agreements). They appear under *Administration → Integrations* with their prerequisites and current fallbacks. |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions and what remains before production.
