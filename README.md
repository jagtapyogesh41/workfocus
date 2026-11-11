# ShiftFocus

**Attendance-linked focus controls for industrial workplaces.**

ShiftFocus is a concept for helping workplace teams reduce distractions from selected social and short-video apps during working hours. A verified attendance event starts a configured focus policy; clock-out ends it. The initial direction is an Android-first, small workplace pilot.

> **Status:** Early-stage concept. No production app, attendance connector, or device-management implementation is included yet.

## The problem

In some industrial workplaces, employees may spend work time on social or short-video apps. This can interrupt tasks and contribute to delays. ShiftFocus proposes testing whether limiting access to selected apps during shifts improves agreed work outcomes.

The product should validate this problem with workers and workplace data. Phone use may be one of several causes of delays, so the pilot should measure work outcomes rather than assume app restrictions will improve productivity.

## Proposed workflow

1. A company registers and configures a workplace policy.
2. An employee registers with a phone number and requests to join the company.
3. An authorized company administrator verifies and approves the employee.
4. The employee's device is enrolled using a supported device-management approach.
5. The attendance system reports a clock-in event. A connector sends the event to ShiftFocus.
6. The focus policy restricts only the apps selected by the company for that shift.
7. Phone calls, SMS, and WhatsApp remain available under the initial policy proposal.
8. A break or clock-out event changes or ends the policy according to the configured schedule.
9. The employee can immediately use an emergency override. The event is recorded and the administrator is notified for follow-up; emergency access does not wait for administrator approval.

## Attendance integration

There is no single integration that works with every biometric or card attendance system. Integration depends on the terminal and the attendance software used by each workplace.

Preferred integration order:

1. Official attendance-software API or webhook.
2. Official terminal or platform API/SDK.
3. A supported integration connector or middleware.
4. Scheduled CSV export for an initial, non-real-time pilot.

For locally hosted attendance software, the proposed architecture is a small connector on the client's server that reads supported attendance events and sends normalized events to the ShiftFocus service over a secure outbound connection. Employee phones should not connect directly to the attendance server.

Example normalized event:

```json
{
  "employee_id": "184",
  "event_type": "clock_in",
  "timestamp": "2026-01-15T08:02:00+05:30",
  "source": "client_attendance_system"
}
```

The connector must account for duplicate, delayed, missing, or corrected events. A client integration should begin only after confirming the attendance vendor, software version, supported interface, employee identifier mapping, and client authorization.

## Device-management considerations

Employee account approval and phone app enforcement are separate capabilities. Verifying that an employee belongs to a company does not by itself prevent app removal or guarantee that other apps can be restricted.

The first technical feasibility study should compare company-owned or formally managed Android devices with employee-owned personal phones. Strong enforcement and resistance to removal generally depend on supported device-management enrollment. iOS should be assessed separately because its control and enrollment options differ.

## Pilot proposal

1. Select one workplace and a willing team.
2. Record the attendance terminal make/model and attendance-software name/version.
3. Confirm that the attendance system can provide reliable clock-in, break, and clock-out events.
4. Agree with workers and management on the restricted app list, available essentials, breaks, emergency override, and correction process.
5. Run a small Android pilot on appropriately enrolled devices.
6. Review policy timing, integration errors, emergency overrides, worker feedback, and a selected work outcome such as task completion or delays.
7. Decide whether to revise, expand, or stop based on the findings.

Internet connectivity is not evidence that an employee is using a particular app. Connectivity status should not be used to infer app use or trigger disciplinary action.

## Initial scope ideas

- Company and employee registration
- Administrator approval of employee requests
- Configurable, explicit list of apps to restrict
- Attendance event ingestion through a vendor-supported interface
- Shift and break policy handling
- Immediate emergency override with an audit event and admin notification
- Basic operational status and error handling

These are product goals, not implemented features.

## Open questions

- Which attendance system and software will be supported first?
- Will the pilot use company-owned or personal phones?
- What Android Enterprise enrollment method is appropriate for the pilot?
- Which specific apps are included in the initial restriction policy?
- How should unscheduled breaks, missed punches, and attendance corrections affect restrictions?
- What work outcome will the pilot measure, and how will workers participate in evaluating it?

## Privacy and deployment principles

- Collect only the employee and attendance data needed to operate the policy.
- Do not treat network connectivity as proof of app use.
- Make the restricted-app policy and emergency override clear to employees.
- Keep an auditable record of policy changes and overrides.
- Set data retention, access controls, and worker notice before a pilot.
- Confirm applicable employment, privacy, and device-management requirements with the client before deployment.

## Repository status

This repository currently documents the idea and proposed pilot direction. Architecture, platform feasibility, integrations, and worker policy still need validation before implementation.
