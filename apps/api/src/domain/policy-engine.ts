/**
 * Pure, side-effect-free policy engine.
 *
 * Given an employee's attendance events (in any arrival order), it derives the
 * current shift state and then decides which device mode should apply.
 * Keeping this pure makes the reconciliation rules easy to test and audit.
 */

export const ATTENDANCE_EVENT_TYPES = ['clock_in', 'break_start', 'break_end', 'clock_out'] as const;
export type AttendanceEventType = (typeof ATTENDANCE_EVENT_TYPES)[number];
export type ShiftState = 'off_shift' | 'on_shift' | 'on_break';
export type DeviceMode = 'focus' | 'unrestricted';
export type BreakMode = 'unrestricted' | 'focus';

export type DecisionReason =
  | 'not_approved'
  | 'not_enrolled'
  | 'emergency_override'
  | 'off_shift'
  | 'on_break'
  | 'on_break_focus'
  | 'fail_safe_max_shift'
  | 'on_shift';

export interface EngineEvent {
  id: string;
  type: AttendanceEventType;
  occurredAt: Date;
}

export type AnomalyCode =
  | 'duplicate_clock_in'
  | 'break_without_shift'
  | 'break_end_without_break'
  | 'clock_out_without_shift'
  | 'future_event_ignored';

export interface ShiftComputation {
  state: ShiftState;
  shiftStartedAt: Date | null;
  breakStartedAt: Date | null;
  lastEventAt: Date | null;
  lastClockOutAt: Date | null;
  anomalies: { eventId: string; code: AnomalyCode }[];
}

/** Events stamped further than this into the future (clock skew) are ignored until they become current. */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function computeShiftState(events: EngineEvent[], now: Date): ShiftComputation {
  const anomalies: ShiftComputation['anomalies'] = [];
  const horizon = now.getTime() + FUTURE_TOLERANCE_MS;

  const usable = events.filter((e) => {
    if (e.occurredAt.getTime() > horizon) {
      anomalies.push({ eventId: e.id, code: 'future_event_ignored' });
      return false;
    }
    return true;
  });

  // Order by when the punch happened, not when it arrived: handles late and reordered delivery.
  usable.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));

  let state: ShiftState = 'off_shift';
  let shiftStartedAt: Date | null = null;
  let breakStartedAt: Date | null = null;
  let lastClockOutAt: Date | null = null;
  let lastEventAt: Date | null = null;

  for (const e of usable) {
    lastEventAt = e.occurredAt;
    switch (e.type) {
      case 'clock_in':
        if (state === 'off_shift') {
          state = 'on_shift';
          shiftStartedAt = e.occurredAt;
        } else {
          // Repeated punch: keep the original shift start so fail-safe timing is not reset.
          anomalies.push({ eventId: e.id, code: 'duplicate_clock_in' });
          if (state === 'on_break') {
            state = 'on_shift';
            breakStartedAt = null;
          }
        }
        break;
      case 'break_start':
        if (state === 'on_shift') {
          state = 'on_break';
          breakStartedAt = e.occurredAt;
        } else if (state === 'off_shift') {
          anomalies.push({ eventId: e.id, code: 'break_without_shift' });
        }
        break;
      case 'break_end':
        if (state === 'on_break') {
          state = 'on_shift';
          breakStartedAt = null;
        } else {
          anomalies.push({ eventId: e.id, code: 'break_end_without_break' });
        }
        break;
      case 'clock_out':
        if (state === 'off_shift') {
          anomalies.push({ eventId: e.id, code: 'clock_out_without_shift' });
        }
        state = 'off_shift';
        shiftStartedAt = null;
        breakStartedAt = null;
        lastClockOutAt = e.occurredAt;
        break;
    }
  }

  return { state, shiftStartedAt, breakStartedAt, lastEventAt, lastClockOutAt, anomalies };
}

export interface ModeInput {
  employeeApproved: boolean;
  deviceEnrolled: boolean;
  shift: Pick<ShiftComputation, 'state' | 'shiftStartedAt'>;
  overrideActive: boolean;
  breakMode: BreakMode;
  maxShiftHours: number;
  now: Date;
}

export interface ModeDecision {
  mode: DeviceMode;
  reason: DecisionReason;
}

/**
 * Decide the device mode. Order matters: every safety exit (not approved, not
 * enrolled, emergency override, fail-safe) resolves to `unrestricted`.
 */
export function decideMode(input: ModeInput): ModeDecision {
  if (!input.employeeApproved) return { mode: 'unrestricted', reason: 'not_approved' };
  if (!input.deviceEnrolled) return { mode: 'unrestricted', reason: 'not_enrolled' };
  if (input.overrideActive) return { mode: 'unrestricted', reason: 'emergency_override' };

  const { state, shiftStartedAt } = input.shift;
  if (state === 'off_shift') return { mode: 'unrestricted', reason: 'off_shift' };

  // Bounded fail-safe: never leave restrictions on indefinitely after a missing clock-out.
  if (shiftStartedAt && input.now.getTime() - shiftStartedAt.getTime() > input.maxShiftHours * 3_600_000) {
    return { mode: 'unrestricted', reason: 'fail_safe_max_shift' };
  }

  if (state === 'on_break') {
    return input.breakMode === 'focus'
      ? { mode: 'focus', reason: 'on_break_focus' }
      : { mode: 'unrestricted', reason: 'on_break' };
  }
  return { mode: 'focus', reason: 'on_shift' };
}

export const REASON_LABELS: Record<DecisionReason, string> = {
  not_approved: 'Employee not approved',
  not_enrolled: 'Device not enrolled',
  emergency_override: 'Emergency override active',
  off_shift: 'Off shift',
  on_break: 'On break',
  on_break_focus: 'On break (focus policy continues)',
  fail_safe_max_shift: 'Fail-safe: shift exceeded maximum length without clock-out',
  on_shift: 'On shift',
};
