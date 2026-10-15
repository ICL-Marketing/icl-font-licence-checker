// The contact finders: what is connected, what has been spent this month, and a Test button.
import { finderStatus, testFinder, resetFinder } from "@/lib/enrich";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return Response.json({ finders: await finderStatus() });
}

export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const id = String(b.id || "");
  if (!id) return Response.json({ ok: false, detail: "Which finder?" }, { status: 400 });
  if (b.reset) { await resetFinder(id); return Response.json({ ok: true, detail: "Ready to try again." }); }
  return Response.json(await testFinder(id));
}
