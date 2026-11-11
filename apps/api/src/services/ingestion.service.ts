import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Db, Queryable } from '../db/db.service';
import { ATTENDANCE_EVENT_TYPES } from '../domain/policy-engine';
import { Actor, AuditService } from './audit.service';
import { JobQueue } from './job-queue';

/** Normalized attendance event contract (see docs/openapi.yaml and PRODUCT_PLAN.md §4). */
export const normalizedEventSchema = z.object({
  event_id: z.string().min(1).max(200),
  employee_id: z.string().min(1).max(100),
  event_type: z.enum(ATTENDANCE_EVENT_TYPES),
  occurred_at: z.string().datetime({ offset: true }),
  correction_status: z.enum(['original', 'corrected', 'voided']).default('original'),
  terminal_id: z.string().max(100).optional(),
});
export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;

export type EventResultStatus = 'accepted' | 'accepted_unmapped' | 'duplicate' | 'corrected' | 'voided' | 'rejected';

export interface IngestResult {
  received: number;
  counts: Record<EventResultStatus, number>;
  results: { event_id: string; status: EventResultStatus; error?: string }[];
}

export interface IngestContext {
  companyId: string;
  sourceSystem: string;
  actor: Actor;
  enteredBy?: string | null;
  reason?: string | null;
  /** Reconcile synchronously instead of via the queue (manual HR corrections). */
  reconcileInline?: (employeeIds: string[]) => Promise<void>;
}

/**
 * Idempotent ingestion: the vendor event ID (scoped by company + source system)
 * is the dedupe key. Repeats are ignored; explicit corrections/voids update the
 * stored event and trigger reconciliation for every affected employee.
 */
@Injectable()
export class IngestionService {
  constructor(
    private readonly db: Db,
    private readonly jobs: JobQueue,
    private readonly audit: AuditService,
  ) {}

  /** Parse a batch leniently: valid events are processed, invalid ones are reported as rejected. */
  splitValid(raw: unknown[]): { valid: NormalizedEvent[]; rejected: IngestResult['results'] } {
    const valid: NormalizedEvent[] = [];
    const rejected: IngestResult['results'] = [];
    raw.forEach((item, i) => {
      const r = normalizedEventSchema.safeParse(item);
      if (r.success) valid.push(r.data);
      else {
        const id = typeof (item as any)?.event_id === 'string' ? (item as any).event_id : `#${i}`;
        rejected.push({
          event_id: id,
          status: 'rejected',
          error: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '),
        });
      }
    });
    return { valid, rejected };
  }

  async ingest(ctx: IngestContext, events: NormalizedEvent[], prior: IngestResult['results'] = []): Promise<IngestResult> {
    const results: IngestResult['results'] = [...prior];
    const affected = new Map<string, Date>(); // employeeId -> earliest receipt time

    for (const ev of events) {
      results.push(await this.db.tx((q) => this.ingestOne(q, ctx, ev, affected)));
    }

    if (ctx.reconcileInline) {
      await ctx.reconcileInline([...affected.keys()]);
    } else {
      for (const [employeeId, receivedAt] of affected) {
        await this.jobs.enqueue(
          'reconcile_employee',
          { employeeId, triggerReceivedAt: receivedAt.toISOString() },
          { dedupeKey: `reconcile:${employeeId}` },
        );
      }
    }

    const counts = { accepted: 0, accepted_unmapped: 0, duplicate: 0, corrected: 0, voided: 0, rejected: 0 };
    for (const r of results) counts[r.status]++;
    return { received: results.length, counts, results };
  }

  private async ingestOne(
    q: Queryable,
    ctx: IngestContext,
    ev: NormalizedEvent,
    affected: Map<string, Date>,
  ): Promise<IngestResult['results'][number]> {
    const touch = (employeeId: string | null | undefined, at: Date) => {
      if (!employeeId) return;
      const prev = affected.get(employeeId);
      if (!prev || at < prev) affected.set(employeeId, at);
    };

    const emp = await q.one<{ id: string }>(
      `select id from employees where company_id = $1 and external_employee_id = $2`,
      [ctx.companyId, ev.employee_id],
    );
    const inserted = await q.one<{ id: string; received_at: Date }>(
      `insert into attendance_events
         (company_id, source_system, vendor_event_id, external_employee_id, employee_id, event_type,
          occurred_at, correction_status, terminal_id, entered_by, reason, raw)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (company_id, source_system, vendor_event_id) do nothing
       returning id, received_at`,
      [
        ctx.companyId,
        ctx.sourceSystem,
        ev.event_id,
        ev.employee_id,
        emp?.id ?? null,
        ev.event_type,
        ev.occurred_at,
        ev.correction_status,
        ev.terminal_id ?? null,
        ctx.enteredBy ?? null,
        ctx.reason ?? null,
        JSON.stringify(ev),
      ],
    );

    if (inserted) {
      touch(emp?.id, inserted.received_at);
      if (ctx.actor.type === 'admin') {
        await this.audit.record(
          {
            companyId: ctx.companyId,
            actor: ctx.actor,
            action: 'attendance.manual_event',
            targetType: 'attendance_event',
            targetId: inserted.id,
            details: { eventType: ev.event_type, occurredAt: ev.occurred_at, employee: ev.employee_id, reason: ctx.reason },
          },
          q,
        );
      }
      return { event_id: ev.event_id, status: emp ? 'accepted' : 'accepted_unmapped' };
    }

    if (ev.correction_status === 'original') return { event_id: ev.event_id, status: 'duplicate' };

    // Explicit correction or void from the source system.
    const existing = await q.one<{ id: string; employee_id: string | null }>(
      `select id, employee_id from attendance_events
       where company_id = $1 and source_system = $2 and vendor_event_id = $3 for update`,
      [ctx.companyId, ctx.sourceSystem, ev.event_id],
    );
    if (!existing) return { event_id: ev.event_id, status: 'rejected', error: 'concurrent modification' };
    await q.query(
      `update attendance_events set event_type = $2, occurred_at = $3, correction_status = $4,
         external_employee_id = $5, employee_id = $6, corrected_at = now(), raw = $7
       where id = $1`,
      [existing.id, ev.event_type, ev.occurred_at, ev.correction_status, ev.employee_id, emp?.id ?? null, JSON.stringify(ev)],
    );
    await this.audit.record(
      {
        companyId: ctx.companyId,
        actor: ctx.actor,
        action: `attendance.${ev.correction_status}`,
        targetType: 'attendance_event',
        targetId: existing.id,
        details: { vendorEventId: ev.event_id, eventType: ev.event_type, occurredAt: ev.occurred_at },
      },
      q,
    );
    const now = new Date();
    touch(existing.employee_id, now);
    touch(emp?.id, now);
    return { event_id: ev.event_id, status: ev.correction_status };
  }

  /** CSV fallback: header `event_id,employee_id,event_type,occurred_at[,correction_status,terminal_id]`. */
  parseCsv(text: string): unknown[] {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (!lines.length) return [];
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    return lines.slice(1).map((line) => {
      const cells = line.split(',').map((c) => c.trim());
      const obj: Record<string, string> = {};
      header.forEach((h, i) => {
        if (cells[i]) obj[h] = cells[i];
      });
      return obj;
    });
  }
}
