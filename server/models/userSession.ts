import { createHash } from 'crypto';
import { query, update, withTransaction } from '../db/connection.js';

export interface UserSession {
  id: number;
  user_id: number;
  session_id: string;
  refresh_token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  last_seen_at: Date;
}

const USER_SESSIONS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS \`user_sessions\` (
    \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`user_id\` BIGINT UNSIGNED NOT NULL,
    \`session_id\` CHAR(36) NOT NULL,
    \`refresh_token_hash\` CHAR(64) NOT NULL,
    \`user_agent\` VARCHAR(500) DEFAULT NULL,
    \`ip_address\` VARCHAR(100) DEFAULT NULL,
    \`expires_at\` DATETIME NOT NULL,
    \`revoked_at\` DATETIME DEFAULT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`last_seen_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uk_user_sessions_session_id\` (\`session_id\`),
    UNIQUE KEY \`uk_user_sessions_refresh_token_hash\` (\`refresh_token_hash\`),
    KEY \`idx_user_sessions_user_active\` (\`user_id\`, \`revoked_at\`, \`expires_at\`),
    CONSTRAINT \`fk_user_sessions_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='User login sessions'
`;

let sessionSchemaReady: Promise<void> | null = null;

export async function ensureUserSessionSchema(): Promise<void> {
  if (!sessionSchemaReady) {
    sessionSchemaReady = query(USER_SESSIONS_TABLE_DDL)
      .then(() => undefined)
      .catch((error) => {
        sessionSchemaReady = null;
        throw error;
      });
  }
  await sessionSchemaReady;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createExclusiveUserSession(data: {
  userId: number;
  sessionId: string;
  refreshTokenHash: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  expiresAt: Date;
}): Promise<void> {
  await ensureUserSessionSchema();
  await withTransaction(async (tx) => {
    await tx.update(
      'UPDATE `user_sessions` SET `revoked_at` = NOW() WHERE `user_id` = ? AND `revoked_at` IS NULL',
      [data.userId]
    );
    await tx.insert(
      `INSERT INTO \`user_sessions\`
        (\`user_id\`, \`session_id\`, \`refresh_token_hash\`, \`user_agent\`, \`ip_address\`, \`expires_at\`)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.userId,
        data.sessionId,
        data.refreshTokenHash,
        data.userAgent || null,
        data.ipAddress || null,
        data.expiresAt,
      ]
    );
  });
}

export async function getActiveSession(userId: number, sessionId: string): Promise<UserSession | null> {
  await ensureUserSessionSchema();
  const rows = await query<UserSession>(
    `SELECT * FROM \`user_sessions\`
     WHERE \`user_id\` = ?
       AND \`session_id\` = ?
       AND \`revoked_at\` IS NULL
       AND \`expires_at\` > NOW()
     LIMIT 1`,
    [userId, sessionId]
  );
  return rows[0] || null;
}

export async function getActiveSessionByRefreshToken(refreshTokenHash: string): Promise<UserSession | null> {
  await ensureUserSessionSchema();
  const rows = await query<UserSession>(
    `SELECT * FROM \`user_sessions\`
     WHERE \`refresh_token_hash\` = ?
       AND \`revoked_at\` IS NULL
       AND \`expires_at\` > NOW()
     LIMIT 1`,
    [refreshTokenHash]
  );
  return rows[0] || null;
}

export async function extendSession(data: {
  userId: number;
  sessionId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<boolean> {
  await ensureUserSessionSchema();
  const result = await update(
    `UPDATE \`user_sessions\`
     SET \`expires_at\` = ?,
         \`user_agent\` = COALESCE(?, \`user_agent\`),
         \`ip_address\` = COALESCE(?, \`ip_address\`),
         \`last_seen_at\` = NOW()
     WHERE \`user_id\` = ?
       AND \`session_id\` = ?
       AND \`refresh_token_hash\` = ?
       AND \`revoked_at\` IS NULL
       AND \`expires_at\` > NOW()`,
    [
      data.expiresAt,
      data.userAgent || null,
      data.ipAddress || null,
      data.userId,
      data.sessionId,
      data.refreshTokenHash,
    ]
  );
  return result.affectedRows > 0;
}

export async function touchSession(userId: number, sessionId: string): Promise<void> {
  await ensureUserSessionSchema();
  await update(
    `UPDATE \`user_sessions\`
     SET \`last_seen_at\` = NOW()
     WHERE \`user_id\` = ? AND \`session_id\` = ? AND \`revoked_at\` IS NULL`,
    [userId, sessionId]
  );
}

export async function revokeSession(userId: number, sessionId: string): Promise<void> {
  await ensureUserSessionSchema();
  await update(
    'UPDATE `user_sessions` SET `revoked_at` = NOW() WHERE `user_id` = ? AND `session_id` = ? AND `revoked_at` IS NULL',
    [userId, sessionId]
  );
}

export async function revokeUserSessions(userId: number): Promise<void> {
  await ensureUserSessionSchema();
  await update(
    'UPDATE `user_sessions` SET `revoked_at` = NOW() WHERE `user_id` = ? AND `revoked_at` IS NULL',
    [userId]
  );
}
