import { Module } from '@nestjs/common';
import { AdminAuthGuard, ConnectorAuthGuard, DeviceAuthGuard } from './common/auth';
import { AdminController } from './controllers/admin.controller';
import { ConnectorController, DeviceController } from './controllers/integration.controller';
import { PublicController } from './controllers/public.controller';
import { config } from './config';
import { Db } from './db/db.service';
import { AuditService, NotificationService, PushService } from './services/audit.service';
import { DeviceService } from './services/device.service';
import { EMM_ADAPTER, MockEmmAdapter, WebhookEmmAdapter } from './services/emm.adapter';
import { IngestionService } from './services/ingestion.service';
import { JobQueue } from './services/job-queue';
import { DeviceSyncService, ReconcileService } from './services/reconcile.service';
import { WorkerService } from './services/worker.service';

@Module({
  controllers: [PublicController, ConnectorController, DeviceController, AdminController],
  providers: [
    Db,
    AuditService,
    NotificationService,
    PushService,
    JobQueue,
    {
      provide: EMM_ADAPTER,
      useFactory: () =>
        config.emm.provider === 'webhook' && config.emm.webhookUrl
          ? new WebhookEmmAdapter()
          : new MockEmmAdapter(),
    },
    ReconcileService,
    DeviceSyncService,
    DeviceService,
    IngestionService,
    WorkerService,
    AdminAuthGuard,
    ConnectorAuthGuard,
    DeviceAuthGuard,
  ],
})
export class AppModule {}
