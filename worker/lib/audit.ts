import { now } from './http';

export async function audit(
  db: D1Database,
  userId: string | null,
  action: string,
  targetType: string | null,
  targetId: string | null,
  details?: unknown,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO audit_log (user_id, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(userId, action, targetType, targetId, details === undefined ? null : JSON.stringify(details), now())
    .run();
}
