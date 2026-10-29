// More detailed titles for a client's existing ideas (the proposal deck's "More detailed titles" button).
import { detailedTitles, researchConfigured } from "@/lib/clientResearch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  if (!researchConfigured()) return Response.json({ error: "Claude isn't set up on the server (ANTHROPIC_API_KEY)." }, { status: 503 });
  try {
    const { client, ideas } = await request.json();
    return Response.json({ titles: await detailedTitles({ client, ideas: Array.isArray(ideas) ? ideas : [] }) });
  } catch (e) {
    return Response.json({ error: `Couldn't rewrite the titles: ${e.message}` }, { status: 500 });
  }
}
