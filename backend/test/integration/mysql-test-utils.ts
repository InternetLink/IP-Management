import mysql from 'mysql2/promise';

class IntegrationDatabaseEnvironmentError extends Error {
  readonly name = 'IntegrationDatabaseEnvironmentError';
}

function integrationDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new IntegrationDatabaseEnvironmentError(
      'DATABASE_URL must be loaded by the integration database harness',
    );
  }
  return databaseUrl;
}

export async function executeMysqlTextProtocol(sql: string): Promise<void> {
  const connection = await mysql.createConnection(integrationDatabaseUrl());
  try {
    await connection.query(sql);
  } finally {
    await connection.end();
  }
}
