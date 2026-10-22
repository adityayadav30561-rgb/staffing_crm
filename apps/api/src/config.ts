export interface Config {
  databaseUrl: string;
  port: number;
  sessionSecret: string;
  appUrl: string;
  isProd: boolean;
  /** Run the automation sweep on an interval (off in tests). */
  automationIntervalMs: number;
  storage: {
    driver: 'local' | 's3';
    localDir: string;
    s3Bucket?: string;
    s3Region?: string;
    s3Endpoint?: string;
    s3AccessKeyId?: string;
    s3SecretAccessKey?: string;
    s3ForcePathStyle?: boolean;
  };
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;
  // Dates (working days, due times, "today") follow the team's timezone.
  env.TZ ??= 'Asia/Kolkata';
  const isProd = env.NODE_ENV === 'production';
  const sessionSecret = env.SESSION_SECRET ?? 'dev-secret-change-me';
  if (isProd && (sessionSecret.length < 32 || sessionSecret.startsWith('change-me'))) {
    throw new Error('SESSION_SECRET must be set to a long random value in production');
  }
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://crm:crm@localhost:5432/crm',
    port: Number(env.PORT ?? 3001),
    sessionSecret,
    appUrl: env.APP_URL ?? 'http://localhost:5173',
    isProd,
    automationIntervalMs: Number(env.AUTOMATION_INTERVAL_MS ?? 5 * 60_000),
    storage: {
      driver: env.STORAGE_DRIVER === 's3' ? 's3' : 'local',
      localDir: env.UPLOAD_DIR ?? 'uploads',
      s3Bucket: env.S3_BUCKET,
      s3Region: env.S3_REGION ?? 'auto',
      s3Endpoint: env.S3_ENDPOINT || undefined,
      s3AccessKeyId: env.S3_ACCESS_KEY_ID,
      s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY,
      s3ForcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    },
    ...overrides,
  };
}
