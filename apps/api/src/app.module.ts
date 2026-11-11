import { Module } from '@nestjs/common';
import { AdminAuthGuard, ConnectorAuthGuard, DeviceAuthGuard } from './common/auth';
import { AdminController } from './controllers/admin.controller';
import { ConnectorController, DeviceController } from './controllers/integration.controller';
import { PublicController } from './controllers/public.controller';
import { Db } from './db/db.service';
import { AuditService, NotificationService, PushService } from './services/audit.service';
import { DeviceService } from './services/device.service';
import { EMM_ADAPTER, MockEmmAdapter } from './services/emm.adapter';
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
    // Replace with a real provider adapter after the EMM decision gate (PRODUCT_PLAN.md §5).
    { provide: EMM_ADAPTER, useClass: MockEmmAdapter },
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
