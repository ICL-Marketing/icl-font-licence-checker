import { getActivity, storeConfigured } from "@/lib/store";

export const dynamic = "force-dynamic";

// The latest changes, newest first: { at, who, area, item, label, changes[] }.
export async function GET(request) {
  if (!storeConfigured()) return Response.json({ shared: false, items: [] });
  const limit = Math.min(2000, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 500));
  return Response.json({ shared: true, items: await getActivity(limit) });
}
