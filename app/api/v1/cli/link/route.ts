import { z } from "zod";
import { linkDevice } from "@/cortex/cli";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";

export const runtime = "nodejs";

const schema = z.object({
  key: z.string().min(8).max(100),
  machine: z.object({
    machineId: z.string().min(8).max(100),
    name: z.string().max(200),
    platform: z.string().max(40),
    arch: z.string().max(40),
    cliVersion: z.string().max(20),
  }),
});

/** POST /api/v1/cli/link — `synapth link <key>`: link key → device token (returned once). */
export const POST = withErrors(async (request: Request) => {
  enforceRequestLimit("cliLink", request);
  const { key, machine } = schema.parse(await request.json());
  const { token, device } = await linkDevice(key, machine);
  return json({ token, device }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
