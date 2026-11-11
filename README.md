# ShiftFocus

**Attendance-linked focus controls for industrial workplaces.**

ShiftFocus helps workplace teams reduce distractions from selected social and short-video apps during working hours. A verified attendance event starts a configured focus policy; a break or clock-out ends it. Workers always retain essential communications (Phone, SMS, WhatsApp) and an immediate, no-approval-required emergency override.

> **Status:** Runnable **Pilot MVP** implemented in this repository (`apps/api` NestJS + PostgreSQL backend, `apps/admin` Next.js admin console & interactive simulator, `docs/openapi.yaml` contract, and automated unit + E2E test suite). Real EMM device enforcement and vendor-specific hardware connectors are cleanly isolated behind adapter boundaries (`EmmAdapter` and `/v1/connector/*`).

---

## Quick Start (Pilot MVP)

### Prerequisites
- Node.js `>= 20`
- PostgreSQL `>= 14` running locally (`postgres://postgres@localhost:5432/shiftfocus` by default, or set `DATABASE_URL`)

### 1. Install, Migrate & Seed Demo Data
```bash
npm install
npm run db:migrate
npm run db:seed
```

This creates the demo workplace **`Demo Plant — Pune Unit 2`** (join code `DEMO-PLANT`), default restricted & always-allowed app lists, sample employees (`101`–`105`), enrolled mock devices, and three role-scoped administrator accounts:

| Role | Email | Password | Capabilities |
|---|---|---|---|
| **Owner** | `owner@demo.local` | `ShiftFocus#2026` | Full access, policy edits, connector key management |
| **HR** | `hr@demo.local` | `ShiftFocus#2026` | Employee approvals, device enrollment, manual punch corrections, override follow-ups |
| **Viewer** | `viewer@demo.local` | `ShiftFocus#2026` | Read-only operational dashboard and audit views |

### 2. Start the API & Admin Console
```bash
npm run dev
```
- **Admin Console & Interactive Pilot Simulator:** `http://localhost:3000`
- **Backend API:** `http://localhost:4000` (`GET /v1/health`)

### 3. Simulate Attendance Punches from the CLI (Optional)
You can trigger punches either from the right-hand **Interactive Pilot Simulator** inside the web console or via the CLI connector simulator:
```bash
npm run simulate -- heartbeat
npm run simulate -- punch 101 clock_in
npm run simulate -- punch 101 break_start
npm run simulate -- punch 101 break_end
npm run simulate -- punch 101 clock_out
npm run simulate -- csv
```

### 4. Run Automated Tests
```bash
npm test
```
Runs both pure policy-engine unit tests ([policy-engine.test.ts](file:///home/antigravity/jagtapyogesh41/workfocus/apps/api/src/domain/policy-engine.test.ts)) and full HTTP + PostgreSQL end-to-end tests ([e2e.test.ts](file:///home/antigravity/jagtapyogesh41/workfocus/apps/api/src/e2e.test.ts)).

---

## Repository Structure

```text
├── apps/
│   ├── api/                         # NestJS + PostgreSQL API, policy engine & worker
│   │   ├── src/
│   │   │   ├── domain/              # Pure shift & policy decision engine + unit tests
│   │   │   ├── db/                  # SQL migrations, transactional pool wrapper, demo seed
│   │   │   ├── common/              # JWT/Connector/Device auth guards, token hashing, Zod validation
│   │   │   ├── services/            # Ingestion, reconciliation, job queue, worker, mock EMM, audit
│   │   │   ├── controllers/         # Public, Connector, Device, and Admin HTTP controllers
│   │   │   └── e2e.test.ts          # End-to-end test suite against PostgreSQL
│   │   └── scripts/
│   │       └── simulate-attendance.mjs
│   └── admin/                       # Next.js (TypeScript + React) Admin Console & Simulator
│       └── app/
│           ├── page.tsx             # Dashboard, approvals, policy editor, audit, terminal + phone simulator
│           └── globals.css
├── docs/
│   └── openapi.yaml                 # OpenAPI 3.1 contract for connector and device APIs
├── PRODUCT_PLAN.md                  # Full product plan and technical direction
└── .env.example                     # Configuration reference
```

---

## Key Architecture & Safety Highlights

1. **Pure, Deterministic Policy Engine ([`policy-engine.ts`](file:///home/antigravity/jagtapyogesh41/workfocus/apps/api/src/domain/policy-engine.ts)):**
   - Evaluates attendance events ordered by `occurred_at` (handling late or out-of-order delivery).
   - Flags anomalies (`duplicate_clock_in`, `break_without_shift`, `clock_out_without_shift`, `future_event_ignored`) without corrupting shift state.
   - Enforces a **bounded fail-safe** (`max_shift_hours`, default 12h): never leaves restrictions active indefinitely if a clock-out event is missed.
2. **Immediate Emergency Override ([`device.service.ts`](file:///home/antigravity/jagtapyogesh41/workfocus/apps/api/src/services/device.service.ts)):**
   - `POST /v1/device/override` immediately transitions the device to `unrestricted`, logs an audit entry, and creates an administrator alert for follow-up — never blocking the worker on admin approval.
3. **Idempotent Ingestion & HR Corrections ([`ingestion.service.ts`](file:///home/antigravity/jagtapyogesh41/workfocus/apps/api/src/services/ingestion.service.ts)):**
   - Deduplicates by `(company_id, source_system, vendor_event_id)`.
   - Supports `original`, `corrected`, and `voided` events, scheduled CSV fallback (`POST /v1/connector/events.csv`), and backfills events that arrived before an employee's attendance ID was mapped.
4. **Privacy by Design:**
   - Stores zero biometric templates, personal messages, or browsing history, and never uses network connectivity as a proxy for app usage.
