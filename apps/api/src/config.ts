/**
 * Runtime configuration. All values can be overridden with environment variables.
 * See `.env.example` at the repository root.
 */
const env = process.env;

const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me';

export const config = {
  nodeEnv: env.NODE_ENV ?? 'development',
  port: Number(env.API_PORT ?? env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/shiftfocus',
  databaseSsl: (env.DATABASE_SSL ?? 'false') === 'true',
  autoMigrate: (env.AUTO_MIGRATE ?? 'true') === 'true',
  /** Allows the interactive simulator and auto-seeding when hosted as a pilot/evaluation environment. */
  pilotDemoMode: (env.PILOT_DEMO_MODE ?? 'false') === 'true',
  autoSeed: (env.AUTO_SEED ?? env.PILOT_DEMO_MODE ?? 'false') === 'true',
  jwtSecret: env.JWT_SECRET ?? DEV_JWT_SECRET,
  jwtTtl: env.JWT_TTL ?? '12h',
  corsOrigin: env.CORS_ORIGIN ?? '*',
  /** Enables the admin-console attendance terminal / phone simulator endpoints. */
  simulatorEnabled: (env.SIMULATOR_ENABLED ?? 'true') === 'true',
  worker: {
    enabled: (env.WORKER_ENABLED ?? 'true') === 'true',
    pollMs: Number(env.WORKER_POLL_MS ?? 500),
    /** Periodic sweep: fail-safe checks, stale job recovery, and device re-sync. */
    sweepMs: Number(env.SWEEP_INTERVAL_MS ?? 30_000),
  },
  emm: {
    provider: (env.EMM_PROVIDER ?? 'mock') as 'mock' | 'webhook',
    webhookUrl: env.EMM_WEBHOOK_URL ?? '',
    webhookSecret: env.EMM_WEBHOOK_SECRET ?? '',
    webhookTimeoutMs: Number(env.EMM_WEBHOOK_TIMEOUT_MS ?? 8000),
  },
  emmMock: {
    latencyMs: Number(env.EMM_MOCK_LATENCY_MS ?? 250),
    /** 0..1 probability that a mock policy push fails (to exercise retries). */
    failureRate: Number(env.EMM_MOCK_FAILURE_RATE ?? 0),
  },
  enrollmentTokenTtlHours: Number(env.ENROLLMENT_TOKEN_TTL_HOURS ?? 24),
  /** A device that has not checked in for this long is reported as stale. */
  deviceStaleMinutes: Number(env.DEVICE_Stale_MINUTES ?? env.DEVICE_STALE_MINUTES ?? 15),
  workerApp: {
    versionCode: Number(env.WORKER_APP_VERSION_CODE ?? 3),
    versionName: env.WORKER_APP_VERSION_NAME ?? '1.2.0',
    apkUrl: env.WORKER_APP_APK_URL ?? '/shiftfocus-worker.apk',
  },
};

export function pgPoolConfig(connectionString = config.databaseUrl) {
  return {
    connectionString,
    ...(config.databaseSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

export function assertProductionSafe(): void {
  if (config.nodeEnv === 'production') {
    if (config.jwtSecret === DEV_JWT_SECRET) {
      throw new Error('JWT_SECRET must be set in production.');
    }
    if (config.simulatorEnabled && !config.pilotDemoMode) {
      throw new Error('SIMULATOR_ENABLED must be false in production unless PILOT_DEMO_MODE=true.');
    }
  }
}
