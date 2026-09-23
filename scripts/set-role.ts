/**
 * `npm run role -- <email|handle> <user|moderator|admin>`
 *
 * Out-of-band role assignment for whoever holds the database credentials —
 * the only way to appoint the first admin on a fresh deployment (in the app,
 * roles are changed by admins only). Without an argument for the role it
 * prints the current one.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { isUserRole, USER_ROLES } from "@/types/auth";

async function main() {
  const [who, role] = process.argv.slice(2);
  if (!who) {
    console.error(`usage: npm run role -- <email|handle> [${USER_ROLES.join("|")}]`);
    process.exit(2);
  }
  if (!hasDatabase) {
    console.error("DATABASE_URL (or NETLIFY_DATABASE_URL) is not set — roles of in-memory users live only in the dev server.");
    process.exit(1);
  }
  const needle = who.replace(/^@/, "").toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: { equals: needle, mode: "insensitive" } }, { handle: { equals: needle, mode: "insensitive" } }] },
    select: { id: true, handle: true, email: true, role: true },
  });
  if (!user) {
    console.error(`No account matches "${who}".`);
    process.exit(1);
  }
  if (!role) {
    console.log(`@${user.handle} <${user.email ?? "no email"}>: ${user.role}`);
    return;
  }
  if (!isUserRole(role)) {
    console.error(`Unknown role "${role}"; expected one of ${USER_ROLES.join(", ")}.`);
    process.exit(2);
  }
  await prisma.user.update({ where: { id: user.id }, data: { role } });
  console.log(`@${user.handle}: ${user.role} → ${role}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
