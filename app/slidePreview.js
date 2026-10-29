// Small previews of the proposal deck's standard slides in the review step, drawn from the same outline as the
// .pptx (lib/deckOutline.js) and laid out like the real slide: sizes are in slide inches and points, scaled to the
// preview's width with container units.
import { LINKEDIN_BLOCKS, supportTable, SERVICE_ROWS } from "@/lib/deckOutline";

const NAVY = "#252560", INDIGO = "#291F8E", TEAL = "#1EDD9B", INK = "#1B1B3A", GREY = "#5B5B78", PALE = "#F3F3FA";
const METAL = { bronze: "#D69C3C", silver: "#C9CBD1", gold: "#F5D63D" };
const METAL_DARK = { bronze: "#A8712A", silver: "#7C808C", gold: "#B8960F" };
const W = 19.44, H = 12.5, IN = 100 / W; // container width units per slide inch
const pt = (n) => `${((n / 72) * IN).toFixed(3)}cqw`;
const inch = (n) => `${(n * IN).toFixed(3)}cqw`;

function Frame({ dark, title, client, top = 2.3, children }) {
  return (
    <div className="@container w-full max-w-[640px]">
      <div className="relative w-full overflow-hidden rounded-md border border-zinc-200 font-sans shadow-sm" style={{ aspectRatio: `${W} / ${H}`, background: dark ? `${NAVY} url(/proposal/bg-dark.jpg) center / cover` : "#fff", color: dark ? "#fff" : INK }}>
        {title && <div className="absolute font-bold uppercase" style={{ left: inch(0.9), right: inch(0.9), top: inch(0.75), fontSize: pt(44), lineHeight: 1.05, color: dark ? "#fff" : NAVY }}>{title}</div>}
        <div className="absolute" style={{ left: inch(0.9), right: inch(0.9), top: inch(top), bottom: inch(1.5) }}>{children}</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dark ? "/proposal/logo-white.png" : "/proposal/logo-navy.png"} alt="" className="absolute" style={{ left: inch(0.9), top: inch(H - 1.15), width: inch(2.3) }} />
        {!dark && client && <div className="absolute text-right uppercase" style={{ right: inch(0.9), top: inch(H - 1.05), fontSize: pt(12), color: GREY, letterSpacing: "0.1em" }}>{client}</div>}
      </div>
    </div>
  );
}
const Num = ({ n, size = 0.75, dark }) => <span className="inline-flex shrink-0 items-center justify-center rounded-full font-bold" style={{ width: inch(size), height: inch(size), background: TEAL, color: NAVY, fontSize: pt(size > 0.8 ? 24 : 20) }}>{dark ? String(n).padStart(2, "0") : n}</span>;

export function AgendaPreview({ items, client }) {
  const two = items.length > 7, per = Math.ceil(items.length / (two ? 2 : 1));
  return (
    <Frame title="Agenda" client={client} top={2.5}>
      <div className="grid h-full" style={{ gridTemplateColumns: two ? "1fr 1fr" : "1fr", gridTemplateRows: `repeat(${per}, ${inch(1.05)})`, gridAutoFlow: "column", columnGap: inch(0.5) }}>
        {items.map((t, i) => <div key={i} className="flex items-center" style={{ gap: inch(0.3) }}><Num n={i + 1} /><span className="truncate font-bold" style={{ fontSize: pt(24), color: NAVY }}>{t}</span></div>)}
      </div>
    </Frame>
  );
}
// The 2x2 grid of numbered blocks (LinkedIn suggestions and the like).
export function BlocksPreview({ title, items, client }) {
  return (
    <Frame title={title} client={client} top={2.4}>
      <div className="grid h-full grid-cols-2" style={{ columnGap: inch(0.7), rowGap: inch(0.7) }}>
        {items.slice(0, 4).map((b, i) => (
          <div key={i} className="flex min-h-0 overflow-hidden" style={{ gap: inch(0.35) }}><Num n={i + 1} size={0.9} />
            <div className="min-w-0"><div className="font-bold uppercase" style={{ fontSize: pt(19), color: NAVY, lineHeight: 1.15 }}>{b.title}</div><div style={{ fontSize: pt(15), lineHeight: 1.25, marginTop: inch(0.08) }}>{b.text}</div></div>
          </div>))}
      </div>
    </Frame>
  );
}
export const LinkedinPreview = ({ posts, prices, client }) => <BlocksPreview title="LinkedIn suggestions" items={LINKEDIN_BLOCKS(posts, prices)} client={client} />;

const th = { background: NAVY, color: "#fff", fontWeight: 700 };
export function SummaryPreview({ summary, client }) {
  const { heads, rows, teams } = summary, many = teams > 3, est = 2 + teams;
  const fs = pt(Math.min(many ? 15 : 17, (7.6 / (rows.length + 1)) * 20));
  return (
    <Frame title="Investment summary" client={client}>
      <table className="w-full border-collapse" style={{ fontSize: fs }}>
        <thead><tr>{heads.map((h, i) => <th key={i} className={i ? "text-center" : "text-left"} style={{ ...th, fontSize: pt(many ? 12 : 16), padding: `${inch(0.08)} ${inch(0.1)}`, paddingLeft: i ? undefined : inch(0.35), border: "1px solid #DADAEA" }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, n) => {
          const total = r.kind === "total";
          return <tr key={n} style={total ? { background: PALE } : {}}>{r.cells.map((c, i) => <td key={i} className={i ? "text-center" : "text-left"} style={{ border: "1px solid #DADAEA", padding: `${inch(0.06)} ${inch(0.1)}`, paddingLeft: i ? undefined : inch(0.35), fontWeight: i === 0 || (i >= est && !(r.kind === "fixed" && i === est)) || (total && i > 1) ? 700 : 400, color: i === 0 || (total && i >= est) ? NAVY : r.free && i >= est ? TEAL : INK }}>{c}</td>)}</tr>;
        })}</tbody>
      </table>
    </Frame>
  );
}
export function CostsPreview({ costs, client }) {
  return (
    <Frame title="Monthly costs" client={client}>
      <table className="w-full border-collapse" style={{ fontSize: pt(16) }}>
        <thead><tr>{["Package", "Covers", "Cost"].map((h, i) => <th key={h} className={i === 2 ? "text-right" : "text-left"} style={{ ...th, padding: `${inch(0.08)} ${inch(0.35)}`, border: "1px solid #DADAEA" }}>{h}</th>)}</tr></thead>
        <tbody>{costs.rows.map(([n, c, p], i) => <tr key={i}><td style={{ border: "1px solid #DADAEA", padding: `${inch(0.1)} ${inch(0.35)}`, fontWeight: 700, color: NAVY }}>{n}</td><td style={{ border: "1px solid #DADAEA", padding: `${inch(0.1)} ${inch(0.35)}` }}>{c}</td><td className="whitespace-nowrap text-right" style={{ border: "1px solid #DADAEA", padding: `${inch(0.1)} ${inch(0.35)}`, fontWeight: 700, color: NAVY }}>{p}</td></tr>)}</tbody>
      </table>
      <div style={{ fontSize: pt(15), color: GREY, marginTop: inch(0.3) }}>{costs.note}</div>
    </Frame>
  );
}
const Pill = ({ children, bg }) => <span className="absolute rounded-full text-center font-bold" style={{ top: inch(-0.25), left: inch(0.45), padding: `0 ${inch(0.3)}`, height: inch(0.5), lineHeight: inch(0.5), background: bg, color: NAVY, fontSize: pt(13), letterSpacing: "0.05em" }}>{children}</span>;
export function TiersPreview({ slide, upsell, client }) {
  return (
    <Frame title="Choose your one-off package" client={client} top={1.95}>
      <div style={{ fontSize: pt(20), color: GREY }}>Silver gives you the most for your budget, and any option can be split over multiple payments if needed.</div>
      <div className="grid grid-cols-3 items-start" style={{ gap: inch(0.35), marginTop: inch(0.55) }}>
        {slide.cards.map((x) => { const on = x.id === "silver"; return (
          <div key={x.id} className="relative" style={{ borderRadius: inch(0.25), background: on ? NAVY : PALE, border: `${on ? 2 : 1}px solid ${on ? METAL[x.id] : PALE}`, padding: `${inch(0.5)} ${inch(0.45)} ${inch(0.35)}`, color: on ? "#fff" : INK, maxHeight: inch(slide.extras.length ? 5.6 : 6.4) }}>
            {on && <Pill bg={TEAL}>RECOMMENDED</Pill>}
            {x.id === "gold" && upsell && <Pill bg={METAL.gold}>+ ONGOING RETAINER</Pill>}
            <div className="font-bold" style={{ fontSize: pt(22), color: on ? METAL[x.id] : METAL_DARK[x.id] }}>{x.label.toUpperCase()}</div>
            <div className="font-bold" style={{ fontSize: pt(x.from ? 42 : 50), lineHeight: 1.1 }}>{x.price}</div>
            <div style={{ fontSize: pt(15), color: on ? "#DCDCF5" : GREY, marginTop: inch(0.1) }}>{x.tagline}</div>
            <ul style={{ marginTop: inch(0.35), fontSize: pt(15) }}>{x.items.map((t, i) => <li key={i} className="flex" style={{ gap: inch(0.12), marginBottom: inch(0.14) }}><span>✓</span><span>{t}</span></li>)}</ul>
          </div>); })}
      </div>
      {slide.extras.length > 0 && <div className="absolute bottom-0 left-0 right-0 flex items-center" style={{ border: `1.5px solid ${TEAL}`, borderRadius: inch(0.2), height: inch(0.85), padding: `0 ${inch(0.4)}`, fontSize: pt(17), gap: inch(0.3) }}><b style={{ color: TEAL }}>+ MONTHLY EXTRA</b>{slide.extras.map(([n, p]) => <span key={n}><b style={{ color: NAVY }}>{n}</b> {p}</span>)}</div>}
    </Frame>
  );
}
export function RoadmapPreview({ roadmap }) {
  const { title, months, ongoing } = roadmap, n = months.length, q = title.indexOf("?") + 1;
  const ONGOING = { bronze: "#A9782F", silver: METAL.silver, gold: METAL.gold };
  return (
    <Frame dark top={2.6}>
      <div className="absolute font-bold uppercase" style={{ left: 0, right: 0, top: inch(0.6 - 2.6), fontSize: pt(36), lineHeight: 1.1 }}>{title.slice(0, q)} <span style={{ color: TEAL }}>{title.slice(q).trim()}</span></div>
      <div className="absolute" style={{ left: inch(-0.9), right: inch(-0.2), top: inch(1.05), height: inch(0.9), background: TEAL, clipPath: "polygon(0 0, 97% 0, 100% 50%, 97% 100%, 0 100%)" }} />
      <div className="relative grid h-full" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {months.map((list, i) => (
          <div key={i} className="min-w-0" style={{ paddingRight: inch(0.3) }}>
            <div className="font-bold" style={{ fontSize: pt(n > 4 ? 52 : 64), lineHeight: inch(1.0), height: inch(1.05) }}>{i + 1}</div>
            <div className="flex items-center font-bold" style={{ height: inch(0.9), fontSize: pt(n > 4 ? 20 : 28), color: NAVY }}>MONTH {i + 1}</div>
            <ul className="list-disc" style={{ marginTop: inch(0.35), paddingLeft: inch(0.25), fontSize: pt(n > 4 ? 16 : 20), lineHeight: 1.2 }}>
              {list.map((t, k) => <li key={k} style={{ marginBottom: inch(0.08) }}>{t}</li>)}
              {ongoing.map((o, k) => <li key={`o${k}`} style={{ marginBottom: inch(0.08), color: ONGOING[o.tier] || "#CFCFF0", fontWeight: ONGOING[o.tier] ? 700 : 400 }}>{o.text}</li>)}
            </ul>
          </div>))}
      </div>
    </Frame>
  );
}
export function SupportPreview({ supportPlan, client }) {
  const st = supportTable(supportPlan), TIER = ["#E4A315", "#AFAFAF", "#E3D42A"], cell = { padding: `${inch(0.04)} ${inch(0.1)}`, verticalAlign: "middle" };
  return (
    <Frame title="Support packages" client={client} top={1.6}>
      <div style={{ fontSize: pt(20) }}>These packages are designed to be used <b>as a starting point only</b>. Depending on your project&apos;s needs, a custom package will be created.</div>
      <table className="w-full border-collapse" style={{ fontSize: pt(16), marginTop: inch(0.15), tableLayout: "fixed" }}>
        <colgroup><col style={{ width: "27%" }} /><col /><col /><col /></colgroup>
        <thead><tr style={{ borderBottom: `1px solid ${INDIGO}` }}><th />{st.heads.map((h, i) => <th key={i} className="text-left font-bold" style={{ ...cell, fontSize: pt(22), color: TIER[i] }}>{h}</th>)}</tr></thead>
        <tbody>
          {st.rows.map(([l, ...v], i) => <tr key={i}><td className="font-bold" style={{ ...cell, color: INDIGO }}>{l}</td>{v.map((x, k) => <td key={k} style={cell}>{Array.isArray(x) ? <><b>{x[0]}</b>{x[1]}</> : x}</td>)}</tr>)}
          <tr style={{ borderTop: `1px solid ${INDIGO}` }}><td className="font-bold" style={{ ...cell, color: INDIGO }}>Monthly Cost</td>{st.cost.map((c) => <td key={c} className="font-bold" style={cell}>{c}</td>)}</tr>
        </tbody>
      </table>
    </Frame>
  );
}
export function ServicesPreview() {
  const px = W / 1900;
  return (
    <Frame dark top={0}>
      <div className="absolute text-center font-bold" style={{ left: 0, right: 0, top: inch(0.75), fontSize: pt(58), color: TEAL, lineHeight: 1.1 }}>OUR SERVICE RETAINER OFFERING</div>
      <div className="absolute text-center" style={{ left: 0, right: 0, top: inch(1.95), fontSize: pt(20) }}>Here is a list of just some of the services ICL can offer you as part of your retainer. <b style={{ color: TEAL }}>*</b></div>
      {SERVICE_ROWS.flatMap(([cy, items]) => items.map(([cx, label]) => (
        <div key={label} className="absolute whitespace-pre text-center font-bold" style={{ left: inch(cx * px - 0.9 - 2.3), width: inch(4.6), top: inch(cy * px - 0.65), fontSize: pt(32), lineHeight: 0.95 }}>{label}</div>)))}
    </Frame>
  );
}
export function PackagePreview({ group: g, client }) {
  const n = g.tiers.length, sz = n > 3 ? 1 : 1.12;
  return (
    <Frame title={g.title} client={client} top={1.95}>
      <div style={{ fontSize: pt(20), color: GREY }}>{g.intro}</div>
      <div className="grid items-start" style={{ gridTemplateColumns: `repeat(${n}, 1fr)`, gap: inch(0.35), marginTop: inch(0.55) }}>
        {g.tiers.map((x) => { const on = g.picked.includes(x.id), metal = METAL[x.id] || TEAL; return (
          <div key={x.id} className="relative" style={{ height: inch(6.4), borderRadius: inch(0.25), background: on ? NAVY : PALE, border: `${on ? 2 : 1}px solid ${on ? metal : PALE}`, padding: `${inch(0.5)} ${inch(0.45)}`, color: on ? "#fff" : INK }}>
            {on && <Pill bg={metal}>RECOMMENDED</Pill>}
            <div className="font-bold uppercase" style={{ fontSize: pt(19 * sz), color: on ? metal : METAL_DARK[x.id] || NAVY }}>{x.name}</div>
            <div className="font-bold uppercase" style={{ fontSize: pt(40 * sz), lineHeight: 1.1 }}>{x.price}</div>
            <div style={{ fontSize: pt(15 * sz), color: on ? "#DCDCF5" : GREY }}>{x.period}</div>
            {x.best && <div style={{ fontSize: pt(15 * sz), color: on ? "#DCDCF5" : GREY, marginTop: inch(0.12) }}>{x.best}</div>}
            <ul className="list-disc" style={{ marginTop: inch(0.15), paddingLeft: inch(0.25), fontSize: pt(14 * sz) }}>{x.items.map((t, i) => <li key={i} style={{ marginBottom: inch(0.05) }}>{t}</li>)}</ul>
          </div>); })}
      </div>
      <div className="absolute bottom-0" style={{ fontSize: pt(14), color: GREY }}>{g.footnote}</div>
    </Frame>
  );
}
// A slide of your own, from the template (Settings → Proposals), shown by its text.
export function TemplateSlidePreview({ text }) {
  return (
    <Frame top={0.9}>
      <div className="flex h-full flex-col items-center justify-center text-center" style={{ fontSize: pt(22), color: GREY }}>
        <div className="font-bold" style={{ fontSize: pt(26), color: NAVY }}>{text}</div>
        <div style={{ marginTop: inch(0.3) }}>Your own slide from the template, copied in as it is.</div>
      </div>
    </Frame>
  );
}
