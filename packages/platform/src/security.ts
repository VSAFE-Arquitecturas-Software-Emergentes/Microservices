import jwt from 'jsonwebtoken';
import {
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
export interface Principal {
  sub: string;
  role: 'user' | 'service';
  iss: string;
  aud: string;
}
export function secret(name: 'SESSION_SECRET' | 'INTERNAL_SECRET'): string {
  const s = process.env[name];
  if (!s || s.length < 32 || s.includes('generate-with'))
    throw new Error(`${name} requires at least 32 random characters`);
  return s;
}
export function internalToken(audience: string, owner = 'system', issuer = 'gateway'): string {
  return jwt.sign({ role: owner === 'system' ? 'service' : 'user' }, secret('INTERNAL_SECRET'), {
    subject: owner,
    issuer,
    audience,
    expiresIn: '60s',
    algorithm: 'HS256',
  });
}
export class InternalGuard implements CanActivate {
  constructor(private readonly service: string) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { principal: Principal }>();
    if (
      req.path.startsWith('/health') ||
      req.path === '/openapi.json' ||
      req.path.startsWith('/docs')
    )
      return true;
    try {
      req.principal = jwt.verify(req.header('x-vsafe-token') || '', secret('INTERNAL_SECRET'), {
        algorithms: ['HS256'],
        audience: this.service,
      }) as Principal;
      return true;
    } catch {
      throw new UnauthorizedException('INVALID_INTERNAL_IDENTITY');
    }
  }
}
export function owner(req: Request): string {
  const p = (req as Request & { principal: Principal }).principal;
  if (p?.role !== 'user') throw new ForbiddenException('USER_CONTEXT_REQUIRED');
  return p.sub;
}
export function technical(req: Request, issuers: string[]): void {
  const p = (req as Request & { principal: Principal }).principal;
  if (p?.role !== 'service' || !issuers.includes(p.iss))
    throw new ForbiddenException('SERVICE_CONTEXT_REQUIRED');
}
export async function internalFetch<T>(
  url: string,
  audience: string,
  issuer: string,
  options: RequestInit = {},
  timeout = 1500,
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-vsafe-token': internalToken(audience, 'system', issuer),
      ...options.headers,
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`UPSTREAM_${response.status}`);
  return response.json() as Promise<T>;
}
