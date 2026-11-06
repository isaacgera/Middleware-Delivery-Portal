/**
 * Prisma client singleton. Imported wherever DB access is needed so we share one connection
 * pool across the app. The generated client comes from prisma/schema.prisma (provider switched
 * by env: SQLite for dev/prototype, Postgres/SQL Server in production).
 */
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
