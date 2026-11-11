import { Injectable, Logger } from '@nestjs/common';
import { Db, Queryable } from '../db/db.service';

export type ActorType = 'admin' | 'employee' | 'connector' | 'system';
export interface Actor {
  type: ActorType;
  id?: string | null;
}
export const SYSTEM: Actor = { type: 'system', id: null };

export interface AuditEntry {
  companyId: string | null;
  actor: Actor;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

/** Append-only audit trail for admin, policy, override and correction actions. */
@Injectable()
export class AuditService {
  constructor(private readonly db: Db) {}

  async record(entry: AuditEntry, q: Queryable = this.db): Promise<void> {
    await q.query(
      `insert into audit_log (company_id, actor_type, actor_id, action, target_type, target_id, details)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.companyId,
        entry.actor.type,
        entry.actor.id ?? null,
        entry.action,
        entry.targetType ?? null,
        entry.targetId ?? null,
        JSON.stringify(entry.details ?? {}),
      ],
    );
  }
}

export interface NotificationInput {
  companyId: string;
  kind: string;
  severity?: 'info' | 'warning' | 'critical';
  title: string;
  body?: string;
  employeeId?: string | null;
}

/** Admin-facing notifications (shown in the console; a real deployment would also email/SMS the contact). */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger('Notifications');
  constructor(private readonly db: Db) {}

  async notify(n: NotificationInput, q: Queryable = this.db): Promise<void> {
    await q.query(
      `insert into notifications (company_id, kind, severity, title, body, employee_id) values ($1,$2,$3,$4,$5,$6)`,
      [n.companyId, n.kind, n.severity ?? 'info', n.title, n.body ?? null, n.employeeId ?? null],
    );
    this.logger.log(`[${n.severity ?? 'info'}] ${n.title}`);
  }
}

/**
 * Push notification stand-in for Firebase Cloud Messaging.
 * Push is only a *hint* to sync: authoritative state lives on the server and is
 * reconciled whenever the device checks in, so a lost push is never fatal.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push(FCM-mock)');

  async sendSyncHint(deviceId: string): Promise<void> {
    this.logger.debug(`sync hint -> device ${deviceId}`);
  }
}
