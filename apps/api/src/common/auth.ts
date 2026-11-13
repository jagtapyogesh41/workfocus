import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { Db } from '../db/db.service';
import { bearer, parseToken, safeEqualHex, sha256 } from './tokens';

export type AdminRole = 'owner' | 'hr' | 'viewer';

export interface AdminPrincipal {
  adminId: string;
  companyId: string;
  role: AdminRole;
  email: string;
}

export interface ConnectorPrincipal {
  connectorId: string;
  companyId: string;
  sourceSystem: string;
}

export interface DevicePrincipal {
  deviceId: string;
  employeeId: string;
  companyId: string;
}

export function signAdminToken(p: AdminPrincipal): string {
  return jwt.sign({ sub: p.adminId, cid: p.companyId, role: p.role, email: p.email }, config.jwtSecret, {
    expiresIn: config.jwtTtl as jwt.SignOptions['expiresIn'],
    issuer: 'shiftfocus',
  });
}

const ROLES_KEY = 'roles';
/** Restrict an admin route to the listed roles (default: any authenticated admin). */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const token = bearer(req.headers.authorization);
    if (!token) throw new UnauthorizedException('Missing bearer token');
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { issuer: 'shiftfocus' }) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const principal: AdminPrincipal = {
      adminId: String(payload.sub),
      companyId: String(payload.cid),
      role: payload.role as AdminRole,
      email: String(payload.email),
    };
    const roles =
      this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (roles.length && !roles.includes(principal.role)) {
      throw new ForbiddenException(`Requires role: ${roles.join(' or ')}`);
    }
    req.admin = principal;
    return true;
  }
}

@Injectable()
export class ConnectorAuthGuard implements CanActivate {
  constructor(private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = bearer(req.headers.authorization);
    const parsed = token && parseToken(token, 'sfc');
    if (!token || !parsed) throw new UnauthorizedException('Missing or malformed connector key');
    const row = await this.db.one<{ id: string; company_id: string; source_system: string; key_hash: string }>(
      'select id, company_id, source_system, key_hash from connectors where key_prefix = $1 and revoked_at is null',
      [parsed.prefix],
    );
    if (!row || !safeEqualHex(row.key_hash, sha256(token))) throw new UnauthorizedException('Invalid connector key');
    req.connector = { connectorId: row.id, companyId: row.company_id, sourceSystem: row.source_system } satisfies ConnectorPrincipal;
    return true;
  }
}

export function signDeviceToken(p: DevicePrincipal): string {
  return jwt.sign({ sub: p.deviceId, eid: p.employeeId, cid: p.companyId, typ: 'device' }, config.jwtSecret, {
    expiresIn: '365d',
    issuer: 'shiftfocus-device',
  });
}

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = bearer(req.headers.authorization);
    if (!token) throw new UnauthorizedException('Missing device token');

    // 1. Stateless JWT device token (allows Android APK and Web PWA to stay signed in simultaneously)
    if (!token.startsWith('sfd_')) {
      try {
        const payload = jwt.verify(token, config.jwtSecret, { issuer: 'shiftfocus-device' }) as jwt.JwtPayload;
        const row = await this.db.one<{ id: string; employee_id: string; company_id: string }>(
          `select id, employee_id, company_id from devices where id = $1 and enrollment_status = 'enrolled'`,
          [String(payload.sub)],
        );
        if (!row) throw new UnauthorizedException('Device unenrolled');
        req.device = { deviceId: row.id, employeeId: row.employee_id, companyId: row.company_id } satisfies DevicePrincipal;
        return true;
      } catch {
        throw new UnauthorizedException('Invalid device token');
      }
    }

    // 2. Legacy sfd_ prefix/hash token
    const parsed = parseToken(token, 'sfd');
    if (!parsed) throw new UnauthorizedException('Malformed device token');
    const row = await this.db.one<{ id: string; employee_id: string; company_id: string; device_token_hash: string }>(
      `select id, employee_id, company_id, device_token_hash from devices
       where device_token_prefix = $1 and enrollment_status = 'enrolled'`,
      [parsed.prefix],
    );
    if (!row || !safeEqualHex(row.device_token_hash, sha256(token))) {
      throw new UnauthorizedException('Invalid device token');
    }
    req.device = { deviceId: row.id, employeeId: row.employee_id, companyId: row.company_id } satisfies DevicePrincipal;
    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminPrincipal => ctx.switchToHttp().getRequest().admin,
);
export const CurrentConnector = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ConnectorPrincipal => ctx.switchToHttp().getRequest().connector,
);
export const CurrentDevice = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): DevicePrincipal => ctx.switchToHttp().getRequest().device,
);
