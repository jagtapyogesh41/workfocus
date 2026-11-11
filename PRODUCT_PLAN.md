# ShiftFocus — Product Plan and Technical Direction

**Document status:** Planning draft  
**Product status:** Early concept; no production software is implemented  
**Initial market hypothesis:** Industrial workplaces where personal social or short-video app use may interrupt work  
**Recommended first validation:** One workplace, one team, Android-first, with a supported attendance integration and appropriately managed devices

## 1. Product summary

ShiftFocus is a proposed attendance-linked focus service. A workplace administrator configures a short list of apps to restrict during work periods. When the attendance system confirms a worker's clock-in, the system applies the agreed focus policy to the enrolled device. A break policy may temporarily change access; clock-out ends the restrictions.

The initial policy proposal keeps ordinary phone calls, SMS, and WhatsApp available. Workers also need an immediate emergency override. The override should restore normal access without waiting for an administrator, record the event, and notify the appropriate workplace contact for follow-up.

The product should test whether this intervention improves a selected work outcome. Reduced access to apps is not itself proof of improved productivity, and internet connectivity is not evidence that a worker used a particular app.

## 2. Goals and non-goals for the first pilot

### Goals

- Validate whether attendance-linked restrictions are technically feasible on the target devices.
- Validate whether a target attendance system can provide reliable clock-in, break, and clock-out events.
- Test a clearly disclosed policy with a small group of workers and administrators.
- Measure policy reliability, worker experience, and an agreed work outcome.
- Learn the integration and deployment effort per workplace.

### Non-goals

- Support every attendance vendor or phone platform in the first release.
- Collect biometric templates, face images, fingerprint data, message contents, or personal browsing history.
- Infer app use from whether the phone has internet access.
- Automatically discipline or rank workers based on phone or attendance signals.
- Claim productivity gains before a pilot demonstrates them.

## 3. User and system flow

1. **Company setup:** A company registers, identifies authorized administrators, and configures its shift and break policy.
2. **Employee request:** An employee registers with a phone number, selects the company, and requests access.
3. **Verification:** An authorized administrator verifies the employee and approves the account.
4. **Device enrollment:** The phone is enrolled through a supported Android Enterprise / EMM path appropriate to the pilot. Account approval and device enforcement are separate steps.
5. **Policy setup:** Administrators select a named, reviewed list of restricted apps. The initial always-available list is calls, SMS, and WhatsApp, subject to device and regional testing.
6. **Attendance event:** The client's attendance system emits a clock-in event. A connector or supported API sends the minimum necessary event data to ShiftFocus.
7. **Policy activation:** ShiftFocus associates the event with the employee and applies the focus policy through the enrolled-device management mechanism.
8. **Break:** A verified break event or agreed schedule changes the policy for the break period.
9. **Emergency override:** The worker can immediately suspend restrictions. The system records the override and alerts the designated administrator. Access is not held pending approval.
10. **Clock-out:** A clock-out event removes the work policy. The system reconciles delayed or corrected events and exposes the resulting status to the administrator and employee.

## 4. Recommended architecture

```text
Attendance terminal(s)
        ↓
Client attendance software / server
        ↓ supported API, webhook, SDK, or export
Client-side connector (only when required)
        ↓ outbound TLS connection
ShiftFocus API and event processor
        ↓                         ↓
Admin web console       Device-management / EMM service
                                  ↓ policy sync
                         Enrolled Android device
```

### Architecture principles

- Integrate with the attendance **software layer** where possible; do not assume all biometric terminals share a protocol.
- Prefer an official vendor API or webhook, then a supported SDK/connector, and use scheduled CSV import only as an early fallback.
- For locally hosted systems, use a small client-side connector that makes outbound authenticated connections. Avoid exposing the client's attendance server to the public internet or connecting employee phones directly to it.
- Normalize vendor events into a common internal model and retain the original vendor event ID for deduplication and audit.
- Process events idempotently so a repeated punch does not repeatedly change device state.
- Model event time, receipt time, source, event type, employee mapping, and correction status separately.
- Use FCM only as a prompt to synchronize or notify. Do not depend on push delivery as the sole record of shift state: Android push messages can be delayed or unavailable. Keep authoritative policy state on the service/device-management side and reconcile on reconnect.
- Keep face/fingerprint/card evidence at the attendance vendor. ShiftFocus needs the resulting employee identifier and attendance event, not the biometric itself.

### Example normalized event

```json
{
  "event_id": "vendor-event-8391",
  "employee_id": "184",
  "event_type": "clock_in",
  "occurred_at": "2026-01-15T08:02:00+05:30",
  "received_at": "2026-01-15T08:02:03+05:30",
  "source_system": "client-attendance-system",
  "correction_status": "original"
}
```

## 5. Recommended technology stack

The stack below favors a small, maintainable pilot. Confirm the device-management mechanism before committing to native restriction code.

| Area | Recommended starting point | Why / notes |
|---|---|---|
| Android client | Kotlin, Android Studio, Jetpack libraries | Native Android gives the best access to supported Android Enterprise integration and device lifecycle APIs. The app should be a user-facing enrollment/status/override client; rely on a supported EMM/device-policy path for enforcement. |
| Device management | Existing EMM provider for the pilot; evaluate Android Enterprise after proving the use case | Strong controls require managed-device enrollment. Google's Android Management API is intended for commercial EMM providers and has permissible-use requirements; do not assume a normal app developer can use it as a generic app-control API. Review eligibility and release requirements before designing around it. |
| Admin web app | TypeScript + React (Next.js) | Common ecosystem for a small admin console, company setup, policy configuration, employee approvals, connector status, and audit views. |
| Backend API | TypeScript + NestJS (or a similarly structured TypeScript service) | A modular API and event-processing service can share types with the admin app. Keep vendor adapters isolated from core policy logic. |
| Database | PostgreSQL | Relational model suits organizations, workers, devices, policies, event histories, and audit records. Use migrations and tenant-scoped access controls from the start. |
| Local attendance connector | .NET Worker Service on Windows, if the client attendance server is Windows-based | Can run as a Windows service near the attendance software. Build a connector only for a vendor-supported interface; start with one client/vendor adapter. |
| Event queue | Start with a database-backed job queue; add a managed queue when volume/reliability needs justify it | Keeps the pilot operationally simple while allowing retries and dead-letter handling. Avoid adding distributed infrastructure before the first integration is understood. |
| Push notifications | Firebase Cloud Messaging for user-visible messages and sync hints | Push is helpful but must not be the sole source of truth or emergency mechanism. Reconcile desired policy state when the device reconnects. |
| Hosting | One managed cloud environment in a region appropriate to pilot data and client requirements | Choose AWS, Azure, or Google Cloud based on client procurement, data-location requirements, and operational familiarity. Use managed PostgreSQL, centralized logs, backups, and secrets management. |
| Authentication | OIDC-compatible identity provider; phone verification for employee registration; MFA for administrators | Separate employee identity verification from device enrollment and administrator authorization. Store phone numbers only when required and protect them as personal data. |
| API description | OpenAPI | Publish the service contract for the local connector and future attendance adapters. |
| Observability | Structured logs, metrics, traces, and alerting | Track connector health, event delay, policy synchronization, override events, and integration failures without logging app contents or biometrics. |

### Device-management decision gate

Before building the app-blocking mechanism, run a technical spike with the intended device models and enrollment mode. Android's lock task mode is designed for dedicated/kiosk-style use and is not automatically equivalent to selectively blocking social apps while leaving the normal phone usable. The Android Management API is an EMM service with restricted permissible use. For an early pilot, working with an established EMM provider is likely the lower-risk route; confirm that it supports the exact policy transitions required.

## 6. Attendance integration strategy

### Per-client discovery checklist

- Terminal manufacturer and exact model(s)
- Attendance software/product name and version
- Local server, cloud service, or hybrid deployment
- Vendor-supported API, webhook, SDK, database export, or report export
- Whether events identify employee, punch type, timestamp, device, and corrections
- Stable employee-ID mapping between the attendance system and ShiftFocus
- Vendor license or partner approval required for integration
- Network route from the client server to the cloud service
- Who owns and approves the integration and credentials

### Integration phases

1. **Discovery:** obtain vendor documentation and a sample event/export; don't access biometric templates.
2. **Read-only prototype:** ingest events in a test environment and compare against the attendance system's own records.
3. **Normalization:** map vendor events into ShiftFocus clock-in, break-start, break-end, clock-out, and correction events.
4. **Reconciliation:** handle duplicate, missing, late, reordered, manually corrected, and overnight-shift events.
5. **Pilot deployment:** install a signed connector if needed, monitor health, and provide a safe manual fallback.

## 7. Measures of success

Agree baselines and targets with the pilot workplace before activation. Report both operational and worker-facing results.

### Integration and policy reliability

- Percentage of attendance events successfully ingested
- Median and 95th-percentile event-to-policy delay
- Percentage of shifts where policy activation and release matched the verified attendance state
- Duplicate, delayed, missing, and corrected event counts
- Connector uptime and time to recover from a connector outage
- Percentage of enrolled devices reporting current policy state
- Emergency override count, reason categories (optional), and follow-up completion time
- False restriction incidents and time to restore normal access

### Work outcomes

Choose one or two measures relevant to the selected team, such as task completion time, units completed, avoidable delays, rework/error rate, or machine idle time. Compare a pre-pilot baseline with the pilot period and account for shift/team differences where feasible. Do not use app restrictions as the only explanatory variable.

### Worker and administrator experience

- Worker understanding of the policy and override
- Worker-reported fairness, usability, and impact on emergency contact
- Number and type of support requests
- Administrator effort per employee and per shift
- Worker opt-in/participation and pilot completion rates

Do not use connectivity state as an app-use or misconduct metric. Avoid collecting per-app activity unless a later, separately reviewed need is established and workers are clearly informed.

## 8. Safety, privacy, and operational considerations

### Emergency and failure behavior

- Emergency override must work immediately without administrator approval.
- Preserve phone calls, SMS, and WhatsApp in the policy, but test availability across device manufacturers, SIM/data conditions, and managed modes.
- Provide a documented recovery path for a wrong punch, failed integration, phone replacement, or administrator outage.
- Decide and disclose what happens if the phone is offline, the connector stops, the server is unreachable, or a clock-out is missing.
- Do not silently leave restrictions active indefinitely after an event-integrity failure. Define a bounded fail-safe behavior with the client and document the trade-off.
- Support manual HR correction and audit its actor, time, reason, and resulting policy action.

### Worker notice and governance

- Explain which apps are restricted, when restrictions apply, what information is collected, who can see it, and how long records are retained.
- Make emergency override behavior and admin notifications clear before enrollment.
- Provide a way to challenge an incorrect attendance-to-device association.
- Limit administrator permissions by role; record policy edits, approvals, overrides, and manual corrections.
- Review local employment, privacy, labor, data-protection, and device-management rules with the client before any live pilot.
- Avoid collecting biometric templates or personal message, photo, browsing, or app-content data.

### Security

- Use TLS for connector and API traffic; use per-client credentials with rotation and revocation.
- Store secrets in a managed secret store, never in app source or plain configuration files.
- Use tenant isolation and least-privilege authorization for all client data.
- Sign and update the local connector; restrict its file, network, and service permissions.
- Minimize retained attendance records and define deletion/retention schedules.
- Keep an audit log for administrator and policy actions, with access controls and tamper-resistant retention appropriate to the pilot.

## 9. Roadmap

### Phase 0 — Discovery

- Interview one prospective client, HR/admin staff, and participating workers.
- Obtain exact attendance hardware/software details and vendor integration documentation.
- Confirm phone ownership, Android models/versions, enrollment expectations, and restricted-app list.
- Define pilot baseline, outcome measure, emergency policy, and required notices.
- Decide whether an EMM partner can implement the required restrictions.

**Exit condition:** A viable attendance event path and a lawful, acceptable device-enrollment path are identified for one client.

### Phase 1 — Technical feasibility spike

- Ingest sample clock events from the selected vendor in a test environment.
- Verify employee mapping, time zone, deduplication, corrections, and overnight shift behavior.
- Demonstrate restrictions and emergency release on the chosen enrolled Android device(s) using the EMM/device-policy mechanism.
- Demonstrate recovery when the phone or connector is offline.

**Exit condition:** End-to-end state changes work reliably on pilot devices with known failure handling.

### Phase 2 — Pilot MVP

- Company/admin setup, employee request and approval, policy configuration, and device enrollment status.
- One attendance connector/API adapter.
- One Android device-management route.
- Clock-in, break, clock-out, manual correction, emergency override, and audit records.
- Basic status dashboard, support workflow, and outcome reporting.

### Phase 3 — Evaluate and expand

- Review technical reliability, worker feedback, administrator burden, and selected work outcomes.
- Revise app policy, onboarding, exception handling, and connector operations.
- Add a second attendance vendor only after the first adapter is stable and repeatable.
- Assess iOS feasibility and legal/operational needs separately before promising iPhone support.

## 10. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| Target attendance software has no supported API | Use vendor-supported export for a small pilot, partner with the vendor/integrator, or choose another pilot client; don't assume direct database access is stable. |
| Personal-phone controls are too weak or unacceptable | Validate enrollment before product build; start with company-owned or formally managed devices and an EMM partner. |
| Push or network outages create stale policy state | Treat push as a sync hint, reconcile state, track freshness, and define bounded fail-safe behavior. |
| Wrong or delayed punch blocks access at the wrong time | Add employee-visible status, immediate override, manual correction, event deduplication, and clear audits. |
| Workers perceive the system as surveillance or punishment | Disclose policy and data collection, minimize monitoring, involve workers in the pilot, and do not infer wrongdoing from connectivity. |
| App list blocks a needed app | Keep the policy list explicit and reviewed; pilot with workers in each relevant role and provide an exception process. |
| Productivity impact is absent or caused by other factors | Use a baseline and compare agreed operational outcomes; stop or revise if benefit is not demonstrated. |

## 11. Immediate next actions

1. Select one prospective pilot client and obtain the exact attendance terminal and software details.
2. Ask that vendor/installer for supported third-party API, webhook, SDK, or export documentation.
3. Identify the Android device models, ownership, and existing EMM/device-management provider.
4. Test whether the selected EMM can restrict the intended apps while preserving calls, SMS, WhatsApp, and emergency release.
5. Agree with workers and management on one measurable work outcome and the pilot's review period.

## 12. Reference documentation

- [Android Management API overview](https://developers.google.com/android/management/introduction) — enterprise enrollment and policy-based management; intended for EMM solutions.
- [Android Management API permissible usage](https://developers.google.com/android/management/permissible-usage) — eligibility and usage requirements.
- [Android lock task mode](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode) — kiosk/dedicated-device behavior and allowlisted apps.
- [Firebase Cloud Messaging priority](https://firebase.google.com/docs/cloud-messaging/android-message-priority) — delivery behavior and background-processing guidance.
- [Hikvision Time & Attendance integration methods](https://tpp.hikvision.com/solutions/TimeAttendance-Integration) — example vendor paths including API, SDK, platform API, and export. Other vendors differ.
