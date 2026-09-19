/**
 * `npx prisma db seed` — loads the demo catalogue into PostgreSQL.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { seedSkills, memoryUsers } from "../cortex/seed";
import { PLATFORM_USER_ID } from "../cortex/billing";
import { usdToMicros } from "../types/economy";

const prisma = new PrismaClient();

async function main() {
  const demoHash = await hash("synapth-demo", 10);

  await prisma.user.upsert({ where: { id: PLATFORM_USER_ID }, create: { id: PLATFORM_USER_ID, name: "Synapth", handle: "synapth", role: "admin", wallet: { create: {} } }, update: {} });

  for (const u of memoryUsers) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: { id: u.id, name: u.name, email: u.email, handle: u.handle, role: u.role, passwordHash: u.id === "usr_demo" ? demoHash : null, wallet: { create: { balanceMicros: u.id === "usr_demo" ? BigInt(usdToMicros(5)) : 0n } } },
      update: {},
    });
  }

  for (const s of seedSkills) {
    await prisma.skill.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        authorId: s.authorId,
        version: s.version,
        category: s.category,
        securityLevel: s.securityLevel,
        downloadsCount: s.downloadsCount,
        githubStars: s.githubStars,
        priceMicros: usdToMicros(s.pricePerCall),
        manifest: s.manifest as unknown as Prisma.InputJsonValue,
        repoUrl: s.repoUrl,
        tags: s.tags,
        createdAt: new Date(s.createdAt),
        stats: { create: { installVelocity7d: s.stats.installVelocity7d, retentionRate: s.stats.retentionRate, executions: s.stats.executions, rating: s.stats.rating } },
        versions: { create: { version: s.version, manifest: s.manifest as unknown as Prisma.InputJsonValue } },
      },
      update: {},
    });
  }
  console.log(`Seeded ${memoryUsers.length + 1} users and ${seedSkills.length} skills.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
