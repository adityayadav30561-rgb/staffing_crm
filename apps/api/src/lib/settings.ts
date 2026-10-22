import { eq } from 'drizzle-orm';
import { settingsSchema, type Settings } from '@crm/shared';
import type { Tx } from '../db';
import { settings } from '../db/schema';

const KEY = 'app';

export async function getSettings(tx: Tx): Promise<Settings> {
  const [row] = await tx.select().from(settings).where(eq(settings.key, KEY));
  return settingsSchema.parse(row?.value ?? {});
}

export async function saveSettings(tx: Tx, value: Settings) {
  await tx
    .insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
