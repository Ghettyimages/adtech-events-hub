type DatabaseEnvironment = NodeJS.ProcessEnv;

export function isIsolatedDatabaseEnvironment(environment: DatabaseEnvironment = process.env): boolean {
  const targetEnvironment = environment.VERCEL_TARGET_ENV || environment.VERCEL_ENV;
  return targetEnvironment === 'preview' || targetEnvironment === 'staging';
}

/**
 * Keep hosted non-production deployments isolated from the production database.
 *
 * The staging Prisma Postgres integration is connected to Vercel Preview with
 * the STORAGE_ prefix, while production continues to use DATABASE_URL.
 */
export function resolveDatabaseUrl(
  environment: DatabaseEnvironment = process.env
): string {
  if (isIsolatedDatabaseEnvironment(environment)) {
    const stagingUrl = environment.STORAGE_DATABASE_URL;
    if (!stagingUrl) {
      throw new Error(
        'STORAGE_DATABASE_URL is required for Vercel Preview and staging deployments'
      );
    }
    if (environment.DATABASE_URL && stagingUrl === environment.DATABASE_URL) {
      throw new Error(
        'STORAGE_DATABASE_URL must not fall back to the production DATABASE_URL'
      );
    }
    return stagingUrl;
  }

  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required outside Vercel Preview and staging');
  }
  return databaseUrl;
}
