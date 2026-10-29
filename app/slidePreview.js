// What's on each of the proposal deck's standard slides, shown in the review step as plain content cards (like the
// Background and Biggest wins blocks), from the same outline as the .pptx (lib/deckOutline.js).
import { LINKEDIN_BLOCKS, supportTable, SERVICE_ROWS } from "@/lib/deckOutline";

const card = "rounded-md border border-zinc-200 p-2 text-sm";
const tbl = "w-full border-collapse text-xs";
const td = "border border-zinc-200 px-2 py-1";
const thc = "border border-zinc-200 bg-zinc-50 px-2 py-1 text-left font-semibold";

function Blocks({ items }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">{items.map((b, i) => (
      <div key={i} className={card}><div className="font-semibold">{b.title}</div><div className="text-zinc-600">{b.text}</div></div>))}
    </div>
  );
}
export function AgendaPreview({ items }) {
  return <ol className={`${card} grid list-inside list-decimal gap-x-4 gap-y-0.5 sm:grid-cols-2`}>{items.map((t, i) => <li key={i}>{t}</li>)}</ol>;
}
export const LinkedinPreview = ({ posts, prices }) => <Blocks items={LINKEDIN_BLOCKS(posts, prices)} />;

export function SummaryPreview({ summary }) {
  return (
    <div className="overflow-x-auto"><table className={tbl}>
      <thead><tr>{summary.heads.map((h, i) => <th key={i} className={thc}>{h}</th>)}</tr></thead>
      <tbody>{summary.rows.map((r, n) => <tr key={n} className={r.kind === "total" ? "bg-zinc-50 font-semibold" : ""}>{r.cells.map((c, i) => <td key={i} className={`${td} ${i ? "" : "font-medium"}`}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
}
export function CostsPreview({ costs }) {
  return (
    <div className="space-y-1"><table className={tbl}>
      <thead><tr>{["Package", "Covers", "Cost"].map((h) => <th key={h} className={thc}>{h}</th>)}</tr></thead>
      <tbody>{costs.rows.map(([n, c, p], i) => <tr key={i}><td className={`${td} font-medium`}>{n}</td><td className={td}>{c}</td><td className={`${td} whitespace-nowrap`}>{p}</td></tr>)}</tbody>
    </table><p className="text-xs text-zinc-500">{costs.note}</p></div>
  );
}
const Tier = ({ name, price, sub, items, badge }) => (
  <div className={card}>
    <div className="flex items-center gap-2"><span className="font-semibold">{name}</span>{badge && <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800">{badge}</span>}</div>
    <div className="text-lg font-bold">{price}</div>
    {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    <ul className="mt-1 space-y-0.5 text-xs">{items.map((t, i) => <li key={i}>✓ {t}</li>)}</ul>
  </div>
);
export function TiersPreview({ slide, upsell }) {
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">{slide.cards.map((x) => <Tier key={x.id} name={x.label} price={x.price} sub={x.tagline} items={x.items} badge={x.id === "silver" ? "Recommended" : x.id === "gold" && upsell ? "+ Ongoing retainer" : ""} />)}</div>
      {slide.extras.length > 0 && <p className="text-xs text-zinc-600"><b>+ Monthly extra:</b> {slide.extras.map(([n, p]) => `${n} ${p}`).join(" · ")}</p>}
    </div>
  );
}
export function RoadmapPreview({ roadmap }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{roadmap.title}</p>
      <div className="grid gap-2 sm:grid-cols-3">{roadmap.months.map((list, i) => (
        <div key={i} className={card}><div className="text-xs font-semibold uppercase text-zinc-500">Month {i + 1}</div>
          <ul className="mt-0.5 space-y-0.5 text-xs">{list.map((t, k) => <li key={k}>• {t}</li>)}{roadmap.ongoing.map((o, k) => <li key={`o${k}`} className="text-zinc-500">• {o.text}</li>)}</ul>
        </div>))}
      </div>
    </div>
  );
}
export function SupportPreview({ supportPlan }) {
  const st = supportTable(supportPlan);
  return (
    <div className="overflow-x-auto"><table className={tbl}>
      <thead><tr><th className={thc} />{st.heads.map((h) => <th key={h} className={thc}>{h}</th>)}</tr></thead>
      <tbody>
        {st.rows.map(([l, ...v], i) => <tr key={i}><td className={`${td} font-medium`}>{l}</td>{v.map((x, k) => <td key={k} className={td}>{Array.isArray(x) ? <><b>{x[0]}</b>{x[1]}</> : x}</td>)}</tr>)}
        <tr className="bg-zinc-50 font-semibold"><td className={td}>Monthly Cost</td>{st.cost.map((c) => <td key={c} className={td}>{c}</td>)}</tr>
      </tbody>
    </table></div>
  );
}
export function ServicesPreview() {
  return <div className={`${card} flex flex-wrap gap-1`}>{SERVICE_ROWS.flatMap(([, items]) => items.map(([, label]) => <span key={label} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">{label.replace("\n", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>))}</div>;
}
export function PackagePreview({ group: g }) {
  return (
    <div className="space-y-1">
      <p className="text-sm"><span className="font-semibold">{g.title}</span> <span className="text-zinc-500">{g.intro}</span></p>
      <div className="grid gap-2 sm:grid-cols-3">{g.tiers.map((x) => <Tier key={x.id} name={x.name} price={`${x.price} ${x.period}`} sub={x.best} items={x.items} badge={g.picked.includes(x.id) ? "Recommended" : ""} />)}</div>
    </div>
  );
}
// A slide of your own, from the template (Settings → Proposals), shown by its text.
export function TemplateSlidePreview({ text }) {
  return <div className={`${card} text-zinc-600`}>{text} <span className="text-xs text-zinc-400">(your own slide from the template, copied in as it is)</span></div>;
}
