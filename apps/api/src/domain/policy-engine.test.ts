import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeShiftState, decideMode, EngineEvent, AttendanceEventType } from './policy-engine';

const t0 = new Date('2026-01-15T08:00:00+05:30').getTime();
const at = (min: number) => new Date(t0 + min * 60_000);
let seq = 0;
const ev = (type: AttendanceEventType, min: number): EngineEvent => ({ id: `e${++seq}`, type, occurredAt: at(min) });

const baseMode = {
  employeeApproved: true,
  deviceEnrolled: true,
  overrideActive: false,
  breakMode: 'unrestricted' as const,
  maxShiftHours: 14,
};

test('clock-in starts a shift and enables focus', () => {
  const shift = computeShiftState([ev('clock_in', 0)], at(10));
  assert.equal(shift.state, 'on_shift');
  assert.deepEqual(shift.shiftStartedAt, at(0));
  assert.deepEqual(decideMode({ ...baseMode, shift, now: at(10) }), { mode: 'focus', reason: 'on_shift' });
});

test('events delivered out of order are evaluated by occurrence time', () => {
  // clock_out arrived before clock_in in the array.
  const shift = computeShiftState([ev('clock_out', 480), ev('clock_in', 0)], at(500));
  assert.equal(shift.state, 'off_shift');
  assert.deepEqual(shift.lastClockOutAt, at(480));
});

test('duplicate clock-in keeps original start and is flagged', () => {
  const shift = computeShiftState([ev('clock_in', 0), ev('clock_in', 2)], at(10));
  assert.equal(shift.state, 'on_shift');
  assert.deepEqual(shift.shiftStartedAt, at(0));
  assert.equal(shift.anomalies[0].code, 'duplicate_clock_in');
});

test('break lifts restrictions by default, or keeps focus when policy says so', () => {
  const shift = computeShiftState([ev('clock_in', 0), ev('break_start', 120)], at(125));
  assert.equal(shift.state, 'on_break');
  assert.equal(decideMode({ ...baseMode, shift, now: at(125) }).reason, 'on_break');
  assert.deepEqual(decideMode({ ...baseMode, breakMode: 'focus', shift, now: at(125) }), {
    mode: 'focus',
    reason: 'on_break_focus',
  });
  const back = computeShiftState([ev('clock_in', 0), ev('break_start', 120), ev('break_end', 150)], at(151));
  assert.equal(back.state, 'on_shift');
});

test('overnight shift crossing midnight stays on shift', () => {
  const start = new Date('2026-01-15T22:00:00+05:30');
  const shift = computeShiftState([{ id: 'n1', type: 'clock_in', occurredAt: start }], new Date('2026-01-16T03:00:00+05:30'));
  assert.equal(shift.state, 'on_shift');
});

test('emergency override always wins over focus', () => {
  const shift = computeShiftState([ev('clock_in', 0)], at(10));
  assert.deepEqual(decideMode({ ...baseMode, overrideActive: true, shift, now: at(10) }), {
    mode: 'unrestricted',
    reason: 'emergency_override',
  });
});

test('fail-safe releases restrictions after max shift length without clock-out', () => {
  const shift = computeShiftState([ev('clock_in', 0)], at(15 * 60));
  assert.deepEqual(decideMode({ ...baseMode, shift, now: at(15 * 60) }), {
    mode: 'unrestricted',
    reason: 'fail_safe_max_shift',
  });
});

test('future-dated events beyond tolerance are ignored', () => {
  const shift = computeShiftState([ev('clock_in', 60)], at(0));
  assert.equal(shift.state, 'off_shift');
  assert.equal(shift.anomalies[0].code, 'future_event_ignored');
});

test('unapproved employees and unenrolled devices are never restricted', () => {
  const shift = computeShiftState([ev('clock_in', 0)], at(1));
  assert.equal(decideMode({ ...baseMode, employeeApproved: false, shift, now: at(1) }).mode, 'unrestricted');
  assert.equal(decideMode({ ...baseMode, deviceEnrolled: false, shift, now: at(1) }).mode, 'unrestricted');
});

test('stray break and clock-out events while off shift are flagged, not fatal', () => {
  const shift = computeShiftState([ev('break_start', 0), ev('break_end', 5), ev('clock_out', 10)], at(11));
  assert.equal(shift.state, 'off_shift');
  assert.deepEqual(
    shift.anomalies.map((a) => a.code),
    ['break_without_shift', 'break_end_without_break', 'clock_out_without_shift'],
  );
});
