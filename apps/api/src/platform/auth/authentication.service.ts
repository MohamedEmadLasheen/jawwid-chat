import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { verifyAccessToken, TokenError } from './access-token';

/**
 * Turns a bearer token into an actor id, using only the identity model the
 * schema already defines (migration 20260905090050):
 *
 *   token.sub -> chat.account.subject (is_active)
 *              -> chat.staff.account_id | chat.contact.account_id
 *              -> actorId
 *
 * Resolution is a raw query rather than a Prisma model because chat.account has
 * no Prisma model and prisma/schema.prisma is AI #2's file. Adding a model there
 * to satisfy authentication would put a second definition of an entity into the
 * client, which docs/product-operations/domain-authority-register.md forbids.
 *
 * Teacher accounts resolve to no actor today: chat.account.kind is
 * ('staff','family') and there is no teacher identity yet (CF-08). A teacher
 * therefore fails authentication rather than being silently admitted -- which is
 * the safe direction, and is why CF-08 stays open rather than being worked
 * around here.
 */
export interface AuthenticatedPrincipal {
  actorId: string;
  accountId: string;
  subject: string;
}

@Injectable()
export class AuthenticationService {
  private readonly log = new Logger(AuthenticationService.name);
  private readonly secret: string;

  constructor(private readonly prisma: PrismaService) {
    this.secret = process.env.AUTH_JWT_SECRET ?? '';
    // Fail fast, and never fall back to a baked-in development secret. RT-005
    // is exactly that mistake made in the storage layer; it is not repeated here.
    if (this.secret.length < 32) {
      throw new Error(
        'AUTH_JWT_SECRET is missing or shorter than 32 characters. ' +
          'The API refuses to start without a real signing secret.',
      );
    }
  }

  /**
   * Returns the principal, or null for any failure. The caller maps null to a
   * single 401 so nothing distinguishes "bad signature" from "unknown account".
   */
  async authenticate(bearer: string | undefined): Promise<AuthenticatedPrincipal | null> {
    if (!bearer) return null;

    const match = /^Bearer\s+(.+)$/i.exec(bearer.trim());
    if (!match) return null;

    let sub: string;
    try {
      sub = verifyAccessToken(match[1], this.secret).sub;
    } catch (error) {
      if (error instanceof TokenError) {
        this.log.debug(`token rejected: ${error.message}`);
        return null;
      }
      throw error;
    }

    const rows = await this.prisma.$queryRaw<Array<{ account_id: string; actor_id: string }>>`
      SELECT a.id AS account_id,
             COALESCE(s.id, c.id) AS actor_id
        FROM chat.account a
        LEFT JOIN chat.staff   s ON s.account_id = a.id AND s.is_active AND s.left_at IS NULL
        LEFT JOIN chat.contact c ON c.account_id = a.id AND c.is_active
       WHERE a.subject = ${sub}
         AND a.is_active
       LIMIT 1
    `;

    const row = rows[0];
    if (!row?.actor_id) return null;

    return { actorId: row.actor_id, accountId: row.account_id, subject: sub };
  }
}
