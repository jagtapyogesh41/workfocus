import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';

export interface AppRef {
  packageName: string;
  label: string;
}

export interface DevicePolicyCommand {
  emmDeviceId: string;
  mode: 'focus' | 'unrestricted';
  restrictedApps: AppRef[];
  alwaysAllowedApps: AppRef[];
  version: number;
}

/**
 * Boundary to the device-management provider (EMM / Android Enterprise).
 *
 * Supports `MockEmmAdapter` (default pilot simulation) and `WebhookEmmAdapter`
 * (when EMM_PROVIDER=webhook and EMM_WEBHOOK_URL is configured) to dispatch
 * signed policy payloads to an external EMM / MDM bridge.
 */
export interface EmmAdapter {
  readonly name: string;
  enrollDevice(input: { deviceId: string; model?: string | null }): Promise<{ emmDeviceId: string }>;
  unenrollDevice(emmDeviceId: string): Promise<void>;
  applyPolicy(cmd: DevicePolicyCommand): Promise<void>;
}

export const EMM_ADAPTER = Symbol('EMM_ADAPTER');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-memory simulated EMM with configurable latency and failure rate. */
@Injectable()
export class MockEmmAdapter implements EmmAdapter {
  readonly name = 'mock-emm';
  private readonly logger = new Logger('MockEMM');
  private readonly applied = new Map<string, DevicePolicyCommand>();

  async enrollDevice(input: { deviceId: string }): Promise<{ emmDeviceId: string }> {
    return { emmDeviceId: `mock-${input.deviceId.slice(0, 8)}` };
  }

  async unenrollDevice(emmDeviceId: string): Promise<void> {
    this.applied.delete(emmDeviceId);
  }

  async applyPolicy(cmd: DevicePolicyCommand): Promise<void> {
    await sleep(config.emmMock.latencyMs);
    if (Math.random() < config.emmMock.failureRate) {
      throw new Error('Mock EMM: transient provider error (simulated)');
    }
    this.applied.set(cmd.emmDeviceId, cmd);
    this.logger.log(
      `${cmd.emmDeviceId} <- ${cmd.mode} v${cmd.version}` +
        (cmd.mode === 'focus' ? ` (blocking ${cmd.restrictedApps.map((a) => a.label).join(', ') || 'nothing'})` : ''),
    );
  }
}

/**
 * Real HTTP Webhook EMM adapter for integrating external MDM/EMM platforms
 * (e.g., Scalefusion, Hexnode, ManageEngine, or a custom Android Management API bridge).
 */
@Injectable()
export class WebhookEmmAdapter implements EmmAdapter {
  readonly name = 'webhook-emm';
  private readonly logger = new Logger('WebhookEMM');

  private async post(payload: Record<string, unknown>, idempotencyKey: string): Promise<any> {
    if (!config.emm.webhookUrl) {
      throw new Error('EMM_WEBHOOK_URL is required when EMM_PROVIDER=webhook');
    }
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };
    if (config.emm.webhookSecret) {
      const sig = createHmac('sha256', config.emm.webhookSecret).update(body).digest('hex');
      headers['x-shiftfocus-signature'] = `sha256=${sig}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.emm.webhookTimeoutMs);
    try {
      const res = await fetch(config.emm.webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`EMM webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return text ? JSON.parse(text) : {};
    } finally {
      clearTimeout(timer);
    }
  }

  async enrollDevice(input: { deviceId: string; model?: string | null }): Promise<{ emmDeviceId: string }> {
    const res = await this.post(
      { action: 'enroll', deviceId: input.deviceId, model: input.model ?? null, timestamp: new Date().toISOString() },
      `enroll:${input.deviceId}`,
    );
    const emmDeviceId = typeof res?.emmDeviceId === 'string' && res.emmDeviceId ? res.emmDeviceId : `emm-${input.deviceId.slice(0, 8)}`;
    this.logger.log(`Enrolled ${input.deviceId} -> ${emmDeviceId}`);
    return { emmDeviceId };
  }

  async unenrollDevice(emmDeviceId: string): Promise<void> {
    await this.post(
      { action: 'unenroll', emmDeviceId, timestamp: new Date().toISOString() },
      `unenroll:${emmDeviceId}`,
    );
    this.logger.log(`Unenrolled ${emmDeviceId}`);
  }

  async applyPolicy(cmd: DevicePolicyCommand): Promise<void> {
    await this.post(
      {
        action: 'apply_policy',
        emmDeviceId: cmd.emmDeviceId,
        mode: cmd.mode,
        version: cmd.version,
        restrictedApps: cmd.restrictedApps,
        alwaysAllowedApps: cmd.alwaysAllowedApps,
        timestamp: new Date().toISOString(),
      },
      `policy:${cmd.emmDeviceId}:v${cmd.version}`,
    );
    this.logger.log(`${cmd.emmDeviceId} <- ${cmd.mode} v${cmd.version} (dispatched via webhook)`);
  }
}
