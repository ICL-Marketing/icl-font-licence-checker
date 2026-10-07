import { pingStore, storeVarsSeen } from "@/lib/store";
import { isConfigured } from "@/lib/auth";
import { figmaConfigured } from "@/lib/figma";
import { leadsConfigured } from "@/lib/leads";
import { keywordsConfigured } from "@/lib/keywords";

export const dynamic = "force-dynamic";

// Health of the two things that make the checker a shared tool: the team
// login (CHECKER_PASSWORD) and the shared store (Upstash Redis via Vercel).
export async function GET() {
  const store = await pingStore();
  return Response.json({ login: isConfigured(), store: { ...store, vars: storeVarsSeen() }, figma: figmaConfigured(), companiesHouse: leadsConfigured(), googleSearch: Boolean(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX), braveSearch: Boolean(process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY), keywords: keywordsConfigured() });
}
