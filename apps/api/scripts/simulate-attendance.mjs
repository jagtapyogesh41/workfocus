#!/usr/bin/env node
/**
 * CLI simulator for a client-side attendance connector.
 *
 * Examples:
 *   npm run simulate -- heartbeat
 *   npm run simulate -- punch 101 clock_in
 *   npm run simulate -- punch 101 break_start
 *   npm run simulate -- punch 101 clock_out
 *   npm run simulate -- csv
 */
import { randomUUID } from 'node:crypto';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const CONNECTOR_KEY = process.env.CONNECTOR_KEY ?? 'sfc_devkey0001_local-development-only-connector-key';

const [cmd = 'help', arg1, arg2, arg3] = process.argv.slice(2);

async function post(path, body, contentType = 'application/json') {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${CONNECTOR_KEY}`,
      'content-type': contentType,
    },
    body: contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}:`, text);
  if (!res.ok) process.exitCode = 1;
}

if (cmd === 'heartbeat') {
  await post('/v1/connector/heartbeat', { version: 'sim-cli/0.1.0' });
} else if (cmd === 'punch') {
  const employeeId = arg1 ?? '101';
  const eventType = arg2 ?? 'clock_in';
  const eventId = arg3 ?? `cli-${randomUUID().slice(0, 8)}`;
  await post('/v1/connector/events', {
    events: [
      {
        event_id: eventId,
        employee_id: employeeId,
        event_type: eventType,
        occurred_at: new Date().toISOString(),
        correction_status: 'original',
        terminal_id: 'TERM-GATE-1',
      },
    ],
  });
} else if (cmd === 'csv') {
  const now = new Date().toISOString();
  const csv = [
    'event_id,employee_id,event_type,occurred_at,correction_status,terminal_id',
    `csv-${randomUUID().slice(0, 8)},101,clock_in,${now},original,TERM-CSV`,
  ].join('\n');
  await post('/v1/connector/events.csv', csv, 'text/csv');
} else {
  console.log(`Usage:
  npm run simulate -- heartbeat
  npm run simulate -- punch <employee_id> <clock_in|break_start|break_end|clock_out> [vendor_event_id]
  npm run simulate -- csv`);
}
