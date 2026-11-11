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
 * Swap `MockEmmAdapter` for a real provider adapter once the device-management
 * decision gate in PRODUCT_PLAN.md §5 is passed. Implementations must be
 * idempotent: re-applying the same version must be harmless.
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
