import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '@precios/shared';
import { AppError } from '@precios/shared';

export interface AdminIdentity {
  label: string;
  role: 'operator' | 'admin';
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminIdentity;
  }
}

export function requireAdmin(db: Kysely<DB>) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('unauthorized', 'Token Bearer ausente');
    }
    const token = header.slice('Bearer '.length).trim();
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const row = await db
      .selectFrom('admin_token')
      .select(['label', 'role'])
      .where('token_hash', '=', tokenHash)
      .where('revoked_at', 'is', null)
      .limit(1)
      .executeTakeFirst();

    if (!row) {
      throw new AppError('unauthorized', 'Token inválido o revocado');
    }
    request.admin = { label: row.label, role: row.role };
  };
}
