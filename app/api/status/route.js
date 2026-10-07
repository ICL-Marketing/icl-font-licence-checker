import { pingStore, storeVarsSeen } from "@/lib/store";
import { isConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Health of the two things that make the checker a shared tool: the team
// login (CHECKER_PASSWORD) and the shared store (Upstash Redis via Vercel).
export async function GET() {
  const store = await pingStore();
  return Response.json({ login: isConfigured(), store: { ...store, vars: storeVarsSeen() } });
}
