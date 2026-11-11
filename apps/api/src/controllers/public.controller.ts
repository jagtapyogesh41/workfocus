import { Body, Controller, Get, HttpCode, Param, Post, UnauthorizedException, NotFoundException, ConflictException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { signAdminToken } from '../common/auth';
import { parse } from '../common/validation';
import { Db } from '../db/db.service';
import { AuditService, NotificationService } from '../services/audit.service';

export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s()-]/g, ''))
  .refine((s) => /^\+?[0-9]{8,15}$/.test(s), 'Enter a valid phone number (8–15 digits, optional +)');

@Controller('v1')
export class PublicController {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  @Get('health')
  async health() {
    await this.db.query('select 1');
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), body);
    const admin = await this.db.one(
      `select a.*, c.name as company_name from admins a join companies c on c.id = a.company_id where lower(a.email) = lower($1)`,
      [email],
    );
    // Compare against a dummy hash when the user is unknown to keep timing similar.
    const ok = await bcrypt.compare(password, admin?.password_hash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    if (!admin || !ok) throw new UnauthorizedException('Invalid email or password');
    await this.audit.record({ companyId: admin.company_id, actor: { type: 'admin', id: admin.id }, action: 'admin.login' });
    return {
      token: signAdminToken({ adminId: admin.id, companyId: admin.company_id, role: admin.role, email: admin.email }),
      admin: { id: admin.id, email: admin.email, fullName: admin.full_name, role: admin.role },
      company: { id: admin.company_id, name: admin.company_name },
    };
  }

  /** Used by the employee app to confirm the company before requesting access. */
  @Get('public/companies/:joinCode')
  async company(@Param('joinCode') joinCode: string) {
    const c = await this.db.one(`select name, join_code from companies where join_code = $1`, [joinCode.toUpperCase()]);
    if (!c) throw new NotFoundException('Unknown company code');
    return { name: c.name, joinCode: c.join_code };
  }

  /**
   * Employee access request. Phone OTP verification is stubbed for the pilot MVP
   * (plug an OTP provider in here); an administrator must still approve the request.
   */
  @Post('public/register')
  async register(@Body() body: unknown) {
    const input = parse(
      z.object({
        joinCode: z.string().min(2).max(40),
        fullName: z.string().trim().min(2).max(120),
        phone: phoneSchema,
        externalEmployeeId: z.string().trim().min(1).max(100).optional(),
      }),
      body,
    );
    const company = await this.db.one(`select id from companies where join_code = $1`, [input.joinCode.toUpperCase()]);
    if (!company) throw new NotFoundException('Unknown company code');
    const existing = await this.db.one(`select id, status from employees where company_id = $1 and phone = $2`, [company.id, input.phone]);
    if (existing) throw new ConflictException(`A request for this phone already exists (status: ${existing.status})`);
    const emp = await this.db.one(
      `insert into employees (company_id, full_name, phone) values ($1,$2,$3) returning id, status, created_at`,
      [company.id, input.fullName, input.phone],
    );
    await this.audit.record({
      companyId: company.id,
      actor: { type: 'employee', id: emp.id },
      action: 'employee.access_requested',
      targetType: 'employee',
      targetId: emp.id,
      details: { claimedExternalId: input.externalEmployeeId ?? null },
    });
    await this.notifications.notify({
      companyId: company.id,
      kind: 'access_request',
      title: `New access request: ${input.fullName}`,
      body: input.externalEmployeeId ? `Claims attendance ID ${input.externalEmployeeId}. Verify before approving.` : undefined,
      employeeId: emp.id,
    });
    return { id: emp.id, status: emp.status, message: 'Request submitted. An administrator must verify and approve it.' };
  }
}
