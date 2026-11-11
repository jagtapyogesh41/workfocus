# ShiftFocus

**Attendance-linked focus controls for industrial workplaces.**

ShiftFocus is an attendance-linked focus management system designed for industrial workplaces where personal social or short-video app use during active shifts may interrupt tasks and contribute to operational delays. When a workplace's attendance system confirms a worker's `clock_in`, ShiftFocus applies a clearly disclosed focus policy to their enrolled Android handset; a verified `break_start` temporarily lifts (or modifies) restrictions, and `clock_out` restores normal access.

> **Status:** Runnable **Pilot MVP** implemented (`apps/api` NestJS + PostgreSQL backend, `apps/admin` Next.js operational console + interactive Pilot Lab, `docs/openapi.yaml` contract, CLI attendance simulator, and 17 unit + E2E tests). Real EMM device enforcement and vendor-specific hardware connectors are isolated behind clean adapter boundaries (`EmmAdapter` and `/v1/connector/*`).

---

## Table of Contents

1. [Quick Start (Run the App)](#1-quick-start-run-the-app)
2. [Demo Credentials & Seeded Workforce](#2-demo-credentials--seeded-workforce)
3. [Using the Interactive Pilot Lab](#3-using-the-interactive-pilot-lab)
4. [CLI Attendance Connector Simulator](#4-cli-attendance-connector-simulator)
5. [Architecture & Repository Layout](#5-architecture--repository-layout)
6. [API Reference](#6-api-reference)
7. [Product Direction, Safety & Privacy Guardrails](#7-product-direction-safety--privacy-guardrails)
8. [Open Pilot Questions](#8-open-pilot-questions)

---

## 1. Quick Start (Run the App)

### Prerequisites
- **Node.js** `>= 20`
- **PostgreSQL** `>= 14` running on `postgres://postgres@localhost:5432/shiftfocus` (or override `DATABASE_URL`)

### Install, Migrate, Seed & Launch
```bash
# 1. Install workspace dependencies
npm install

# 2. Apply SQL migrations and seed the demo workplace ("Demo Plant — Pune Unit 2")
npm run db:migrate
npm run db:seed

# 3. Start both the NestJS API (port 4000) and Next.js Admin Console (port 3000)
npm run dev
```

- **Admin Console & Interactive Pilot Lab:** `http://localhost:3000`
- **Backend API Health Check:** `http://localhost:4000/v1/health`

### Run Automated Tests
```bash
npm test
```
Runs both pure policy-engine unit tests ([`policy-engine.test.ts`](file:///home/antigravity/jagtapyogesh41/workfocus/apps/api/src/domain/policy-engine.test.ts)) and full HTTP + PostgreSQL end-to-end tests ([`e2e.test.ts`](file:///home/antigravity/jagtapyogesh41/workfocus/apps/api/src/e2e.test.ts)).

---

## 2. Demo Credentials & Seeded Workforce

Running `npm run db:seed` provisions the demo workplace **`Demo Plant — Pune Unit 2`** (join code `DEMO-PLANT`), default always-allowed essentials (**Phone**, **Messages (SMS)**, **WhatsApp**), restricted social/short-video apps (**Instagram**, **YouTube**, **Facebook**, **Snapchat**, **Moj**, **Josh**), and three role-scoped administrator accounts:

| Role | Email | Password | Capabilities |
|---|---|---|---|
| **Owner** | `owner@demo.local` | `ShiftFocus#2026` | Full access, Focus Policy edits, connector API key creation/rotation/revocation |
| **HR** | `hr@demo.local` | `ShiftFocus#2026` | Worker approvals, attendance ID mapping, device enrollment, manual HR punch corrections, override follow-ups |
| **Viewer** | `viewer@demo.local` | `ShiftFocus#2026` | Read-only shift floor telemetry, event stream, and audit log |

> **Tip:** You can switch between **Owner**, **HR**, and **Viewer** at any time using the segmented role switcher in the top navigation bar.

### Seeded Workers
| Name | Phone | Attendance ID | Status | Device Enrollment |
|---|---|---|---|---|
| **Asha Patil** | `+919800000101` | `101` | `approved` | `enrolled` (Samsung Galaxy A15) |
| **Ravi Kumar** | `+919800000102` | `102` | `approved` | `enrolled` (Samsung Galaxy A15) |
| **Sunita Jadhav** | `+919800000103` | `103` | `approved` | `enrolled` (Samsung Galaxy A15) |
| **Imran Shaikh** | `+919800000104` | `104` | `approved` | `pending` (not yet enrolled) |
| **Vikram More** | `+919800000105` | *(unmapped)* | `pending` | `pending` (awaiting HR approval) |

---

## 3. Using the Interactive Pilot Lab

The right-hand **Interactive Pilot Lab** in the Admin Console lets you test the entire ShiftFocus lifecycle without physical attendance hardware:

1. **▶ Run Guided Shift Demo (1-Click):**
   Click **▶ Run Guided Shift Demo** (in the page header or Pilot Lab) to automatically step through enrolling the worker's Android handset, clocking in at the gate terminal, starting a break, and returning to active shift focus mode.
2. **Gate Attendance Terminal (`TERM-GATE-1`):**
   Select any approved worker (`101`–`104`) and trigger `Clock In`, `Break Start`, `Break End`, or `Clock Out` punches — or use the inline quick-action buttons directly in the **Workforce Shift & Device Matrix** table.
3. **Simulated Android Enterprise Handset:**
   - Click **Enroll & Connect Handset** to issue a one-time enrollment token (`sfe_...`) and exchange it for an active device credential (`sfd_...`).
   - **Interactive App Launcher Grid:** Tap any app icon on the simulated phone screen. Essential apps (**Phone**, **Messages**, **WhatsApp**) always open; restricted apps (**Instagram**, **YouTube**, **Moj**, etc.) display a **ShiftFocus Blocked** intercept while Focus Shield is active.
   - **⚡ Emergency Override:** Select a reason (`Family emergency`, `Medical need`, `Workplace safety`, etc.) and click **⚡ Emergency Override**. Restrictions lift **immediately** without waiting for administrator approval, an audit entry is recorded, and an alert is raised for HR follow-up in the **Emergency Overrides** tab.
4. **Worker Onboarding Request:**
   Submit a new worker join request (`POST /v1/public/register`), then switch to **Workers & Devices** to assign their attendance terminal ID and approve them.

---

## 4. CLI Attendance Connector Simulator

To simulate an outbound client-side connector service sending events over HTTPS:

```bash
# Send a connector liveness heartbeat
npm run simulate -- heartbeat

# Send attendance punches for employee #101
npm run simulate -- punch 101 clock_in
npm run simulate -- punch 101 break_start
npm run simulate -- punch 101 break_end
npm run simulate -- punch 101 clock_out

# Test the scheduled CSV export fallback (Content-Type: text/csv)
npm run simulate -- csv
```

---

## 5. Architecture & Repository Layout

```text
Attendance terminal(s)
        ↓
Client attendance software / server
        ↓ supported API, webhook, SDK, or CSV export
Client-side connector (outbound TLS with sfc_<prefix>_<secret> key)
        ↓
ShiftFocus API & Idempotent Ingestion (apps/api)
        ↓                         ↓
Next.js Admin Console     PostgreSQL Job Queue (SKIP LOCKED)
  (apps/admin)                    ↓
                          EMM Adapter (MockEmmAdapter / Android Enterprise)
                                  ↓
                          Enrolled Android Device
```

```text
├── apps/
│   ├── api/                         # NestJS + PostgreSQL backend & worker
│   │   ├── src/
│   │   │   ├── domain/              # Pure shift & policy decision engine + unit tests
│   │   │   ├── db/                  # SQL migrations, transactional pg pool, demo seed
│   │   │   ├── common/              # Admin JWT, Connector key & Device token guards, Zod validation
│   │   │   ├── services/            # Ingestion, reconciliation, job queue, worker, mock EMM, audit
│   │   │   ├── controllers/         # Public, Connector, Device, and Admin HTTP controllers
│   │   │   └── e2e.test.ts          # End-to-end test suite against PostgreSQL
│   │   └── scripts/
│   │       └── simulate-attendance.mjs
│   └── admin/                       # Next.js (TypeScript + React) Admin Console & Pilot Lab
│       └── app/
│           ├── page.tsx             # Telemetry, roster, policy editor, audit, terminal + phone lab
│           └── globals.css          # Industrial design system tokens and components
├── docs/
│   └── openapi.yaml                 # OpenAPI 3.1 contract for connector and device APIs
├── PRODUCT_PLAN.md                  # Full product plan and technical direction
└── .env.example                     # Environment variable reference
```

---

## 6. API Reference

Full contract: [`docs/openapi.yaml`](file:///home/antigravity/jagtapyogesh41/workfocus/docs/openapi.yaml).

| Method & Path | Auth | Purpose |
|---|---|---|
| `GET /v1/health` | Public | Service and PostgreSQL health check |
| `POST /v1/auth/login` | Public | Admin login (`owner`, `hr`, `viewer`) returning JWT |
| `GET /v1/public/companies/:joinCode` | Public | Verify company join code during worker onboarding |
| `POST /v1/public/register` | Public | Submit worker access request |
| `POST /v1/connector/heartbeat` | `ConnectorKey` | Record connector liveness and version |
| `POST /v1/connector/events` | `ConnectorKey` | Ingest batch of normalized attendance events (idempotent) |
| `POST /v1/connector/events.csv` | `ConnectorKey` | Scheduled CSV export fallback ingestion |
| `POST /v1/device/enroll` | One-time `sfe_` token | Enroll handset and receive `sfd_` device token |
| `GET /v1/device/status` | `DeviceToken` | Poll current shift state, applied mode, and app lists |
| `POST /v1/device/override` | `DeviceToken` | Immediately suspend restrictions (logs audit + notifies admin) |
| `POST /v1/device/override/end` | `DeviceToken` | Voluntarily end an active emergency override |
| `GET /v1/admin/dashboard` | `AdminJwt` | Shift counts, EMM sync p50/p95 delay, override & queue metrics |
| `GET/POST/PATCH /v1/admin/employees*` | `AdminJwt` | List, approve/map, reject, deactivate, enroll/unenroll devices |
| `GET/PUT /v1/admin/policy` | `AdminJwt` | View or publish workplace focus policy and fail-safe hours |
| `GET/POST /v1/admin/events*` | `AdminJwt` | Inspect events, record manual HR corrections, or void punches |
| `GET/POST /v1/admin/overrides*` | `AdminJwt` | Review emergency overrides and record follow-up notes |
| `GET/POST /v1/admin/connectors*` | `AdminJwt` | Create, rotate, or revoke local attendance connector keys |
| `GET /v1/admin/audit` | `AdminJwt` | Query append-only audit trail |

---

## 7. Product Direction, Safety & Privacy Guardrails

1. **Account Approval ≠ Device Enforcement:** Verifying that an employee belongs to a company does not by itself prevent app removal or restrict third-party apps. Actual enforcement requires supported Android Enterprise / EMM enrollment (`EmmAdapter`).
2. **Immediate Emergency Override:** Workers can always restore normal access immediately without waiting for administrator approval.
3. **Essential Communications Preserved:** Ordinary phone calls, SMS, and WhatsApp remain available under the default policy.
4. **Bounded Fail-Safe:** If a connector goes offline or a worker misses a clock-out punch, ShiftFocus automatically releases restrictions once the shift exceeds `max_shift_hours` (default 12 hours).
5. **No Invasive Surveillance:** ShiftFocus never collects biometric templates, face images, fingerprints, personal messages, photos, or browsing history, and never uses network connectivity as proof of app use or misconduct.

---

## 8. Open Pilot Questions

Before deploying beyond a simulated pilot with a prospective workplace, confirm:
- Which attendance terminal make/model and attendance software version are used, and which official API/webhook/export interface is licensed?
- Will the pilot use company-owned or employee-owned Android devices, and which EMM provider will enforce the policy transitions?
- Which specific apps are included in the workplace's reviewed restriction policy?
- What concrete work outcome (e.g. task completion time, error/rework rate, avoidable delays) will be measured against a pre-pilot baseline, and how will workers participate in evaluating fairness and usability?
