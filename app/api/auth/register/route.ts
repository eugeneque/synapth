import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma, hasDatabase } from "@/cortex/db";
import { memoryUsers } from "@/cortex/seed";
import { billing } from "@/cortex/billing";
import { json, withErrors } from "@/lib/api";

const registerSchema = z.object({
  name: z.string().trim().min(2).max(64),
  handle: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

export const POST = withErrors(async (request: Request) => {
  const input = registerSchema.parse(await request.json());
  const passwordHash = await hash(input.password, 10);

  if (!hasDatabase) {
    if (memoryUsers.some((u) => u.email === input.email || u.handle === input.handle)) {
      return json({ error: "Email or handle already taken" }, { status: 409 });
    }
    const id = `usr_${Math.random().toString(36).slice(2, 10)}`;
    memoryUsers.push({ id, name: input.name, email: input.email, handle: input.handle, image: null, role: "user", passwordHash });
    await billing.topUp(id, 1, "Welcome credit");
    return json({ id, email: input.email }, { status: 201 });
  }

  const exists = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, { handle: input.handle }] }, select: { id: true } });
  if (exists) return json({ error: "Email or handle already taken" }, { status: 409 });

  const user = await prisma.user.create({
    data: { name: input.name, handle: input.handle, email: input.email, passwordHash, wallet: { create: {} } },
    select: { id: true, email: true },
  });
  return json(user, { status: 201 });
});
