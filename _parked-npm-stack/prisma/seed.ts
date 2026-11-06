/**
 * Seed script — creates starter users for the prototype so you can log in immediately.
 * Run with: npm run db:seed
 *
 * NOTE: these are DEV-ONLY default credentials. Change them before any real deployment.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SALT_ROUNDS = 10;

async function main(): Promise<void> {
  const adminPassword = await bcrypt.hash('admin123', SALT_ROUNDS);
  const dmPassword = await bcrypt.hash('manager123', SALT_ROUNDS);

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminPassword,
      displayName: 'MDP Administrator',
      email: 'admin@example.local',
      role: 'ADMINISTRATOR',
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { username: 'manager' },
    update: {},
    create: {
      username: 'manager',
      passwordHash: dmPassword,
      displayName: 'Delivery Manager',
      email: 'manager@example.local',
      role: 'DELIVERY_MANAGER',
      isActive: true,
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seed complete:');
  // eslint-disable-next-line no-console
  console.log('  admin   / admin123   (Administrator)');
  // eslint-disable-next-line no-console
  console.log('  manager / manager123 (Delivery Manager)');
  // eslint-disable-next-line no-console
  console.log('  >> Change these before any real deployment.');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
