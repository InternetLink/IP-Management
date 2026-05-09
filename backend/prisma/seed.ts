import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding IPAM database (tree architecture)...');

  // Settings
  await prisma.appSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', organizationName: '', asn: '', contactEmail: '', defaultRIR: 'APNIC', geofeedHeader: '', geofeedAutoASN: true, defaultCountryCode: 'TW', expiryWarningDays: 30, utilizationThreshold: 85 },
    update: {},
  });

  console.log('Seed complete — empty database ready for use.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
