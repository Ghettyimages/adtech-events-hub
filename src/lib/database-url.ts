type DatabaseEnvironment = NodeJS.ProcessEnv;

function isIsolatedVercelEnvironment(environment: DatabaseEnvironment): boolean {
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
  if (isIsolatedVercelEnvironment(environment)) {
    const stagingUrl = environment.STORAGE_DATABASE_URL;
    if (!stagingUrl) {
      throw new Error(
        'STORAGE_DATABASE_URL is required for Vercel Preview and staging deployments'
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
