import type { Tx } from '../db';
import { notifications } from '../db/schema';

export async function notify(
  tx: Tx,
  userIds: number[],
  n: { title: string; body?: string; link?: string },
  exceptUserId?: number,
) {
  const ids = [...new Set(userIds)].filter((id) => id !== exceptUserId);
  if (!ids.length) return;
  await tx.insert(notifications).values(ids.map((userId) => ({ userId, title: n.title, body: n.body ?? null, link: n.link ?? null })));
}
