import { pingStore, storeVarsSeen } from "@/lib/store";
import { isConfigured } from "@/lib/auth";
import { figmaConfigured } from "@/lib/figma";
import { leadsConfigured, jobsConfigured, placesConfigured } from "@/lib/leads";
import { anyFinder, FINDERS, finderConfigured } from "@/lib/enrich";
import { keywordsConfigured } from "@/lib/keywords";

export const dynamic = "force-dynamic";

// Health of the two things that make the checker a shared tool: the team
// login (CHECKER_PASSWORD) and the shared store (Upstash Redis via Vercel).
export async function GET() {
  const store = await pingStore();
  return Response.json({ login: isConfigured(), store: { ...store, vars: storeVarsSeen() }, figma: figmaConfigured(), companiesHouse: leadsConfigured(), adzuna: jobsConfigured(), places: placesConfigured(), googleSearch: Boolean(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX), braveSearch: Boolean(process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY), keywords: keywordsConfigured(), pexels: Boolean(process.env.PIXABAY_API_KEY || process.env.PEXELS_API_KEY || process.env.UNSPLASH_ACCESS_KEY), finders: anyFinder(), finderCount: FINDERS.filter((f) => finderConfigured(f.id)).length });
}
