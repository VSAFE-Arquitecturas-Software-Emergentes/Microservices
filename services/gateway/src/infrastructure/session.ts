import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Problem } from '@vsafe/contracts';
import { secret } from '@vsafe/platform';
import type { Request, Response } from 'express';
export interface Session {
  sub: string;
  csrf: string;
}
export class Sessions {
  read(req: Request): Session | null {
    try {
      return jwt.verify(req.cookies?.vsafe_session || '', secret('SESSION_SECRET'), {
        algorithms: ['HS256'],
        issuer: 'vsafe',
        audience: 'web',
      }) as Session;
    } catch {
      return null;
    }
  }
  ensure(req: Request, res: Response) {
    let session = this.read(req);
    if (!session) {
      session = { sub: randomUUID(), csrf: randomBytes(24).toString('hex') };
      const token = jwt.sign({ csrf: session.csrf }, secret('SESSION_SECRET'), {
        subject: session.sub,
        issuer: 'vsafe',
        audience: 'web',
        expiresIn: '24h',
        algorithm: 'HS256',
      });
      res.cookie('vsafe_session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 86400000,
        path: '/',
      });
    }
    res.setHeader('cache-control', 'no-store');
    return {
      ownerRef: session.sub,
      csrfToken: session.csrf,
      demo: process.env.DATA_MODE === 'demo',
    };
  }
  authorize(req: Request) {
    const session = this.read(req);
    if (!session) throw new Problem(401, 'SESSION_REQUIRED');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const supplied = req.header('x-csrf-token') || '';
      if (
        supplied.length !== session.csrf.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrf))
      )
        throw new Problem(403, 'CSRF_FAILED');
    }
    return session;
  }
}
