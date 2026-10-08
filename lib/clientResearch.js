// AI research for Client Ideas: Claude researches an existing client on the web (what they really do,
// where, who they compete with, whether the website on file is theirs) and proposes specific ideas,
// each with a short email in our house style. Server only. Needs ANTHROPIC_API_KEY in Vercel.
import Anthropic from "@anthropic-ai/sdk";

export const researchConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);
const MODEL = process.env.CLIENT_IDEAS_MODEL || "claude-opus-5-5";
export const RESEARCH_CAP = Number(process.env.CLIENT_IDEAS_AI_CAP) || 200; // research runs per month

const KINDS = ["fix", "growth", "content", "compliance", "design"];

// The one tool Claude calls at the end with its findings. strict: the input always matches the schema.
const SAVE_TOOL = {
  name: "save_research",
  description: "Save the research and ideas for this client. Call it exactly once, at the end, after researching.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["business_summary", "what_they_do", "location", "website_is_theirs", "correct_website", "website_evidence", "competitors", "sources", "ideas"],
    properties: {
      business_summary: { type: "string", description: "Two sentences: who they are and who their customers are." },
      what_they_do: { type: "string", description: "Their main service or product in a few words, as a customer would search for it (e.g. 'wedding venue', 'commercial cleaning')." },
      location: { type: "string", description: "Town where they actually trade, or 'national' / 'online'." },
      website_is_theirs: { type: "boolean", description: "Is the website we have on file really this business's site?" },
      correct_website: { type: "string", description: "Their real website domain (e.g. example.co.uk), or empty if none found." },
      website_evidence: { type: "string", description: "What confirmed or contradicted the website, in one sentence." },
      competitors: { type: "array", items: { type: "string" }, description: "Up to 4 competitor names or domains customers would also find." },
      sources: { type: "array", items: { type: "string" }, description: "URLs you relied on." },
      ideas: {
        type: "array",
        description: "The 3 best ideas, best first.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "service", "kind", "project_size", "likely", "est_value", "why", "evidence_url", "subject", "email"],
          properties: {
            service: { type: "string", enum: ["Web design", "Web development", "SEO", "PPC", "Content", "Videography", "Photography", "Branding", "Support"] },
            project_size: { type: "string", enum: ["medium", "large"] },
            likely: { type: "string", enum: ["High", "Medium", "Low"], description: "How likely this client is to say yes." },
            est_value: { type: "string", description: "Rough budget range for ICL, e.g. '£3k-£6k'. Internal only, never in the email." },
            title: { type: "string", description: "Short card title, under 60 characters." },
            kind: { type: "string", enum: KINDS },
            why: { type: "string", description: "One or two sentences on why this would help THIS business, citing what you found." },
            evidence_url: { type: "string", description: "The page that shows the gap or opportunity, or empty." },
            subject: { type: "string", description: "Email subject, plain and friendly, under 60 characters." },
            email: { type: "string", description: "Email body only (no greeting, no sign-off). See the style rules." },
          },
        },
      },
    },
  },
};

const SYSTEM = `You help ICL Digital, a web design agency in Richmond (London), find genuinely useful work to suggest to clients they ALREADY work with. ICL builds and looks after websites, and offers web design, SEO, content, videography and photography, hosting and support.

Research the client before suggesting anything:
1. Confirm who the business really is: search their name, check the website on file, and decide whether that site is theirs. If it isn't, find the right one (or say there is none).
2. Learn what they actually sell, to whom, where they trade, and who they compete with. Look at their site, Google results for their main service in their town, reviews and social profiles.
3. Use the automated site findings provided, but only where they matter for this business.

Then propose the 3 best ideas, best first. They must be substantial projects worth several thousand pounds (a booking or quote system, an online shop, a customer portal, an SEO and content campaign, a redesign, new landing pages, a video or photo shoot, integrations or automation), grounded in something you found. No small fixes (footer year, alt text, meta descriptions, analytics, cookie banners), no generic advice, nothing ICL can't deliver.

Important: in most cases ICL designed and built these websites. Never criticise or run down the current site, its design, its build or past decisions, and never call anything outdated, poor, broken, missing or wrong. Frame every idea as a new opportunity or a next step that builds on what's there. Genuine faults (e.g. a lapsed security certificate) can be raised, but as something we've spotted and will take care of.

Email style for each idea (they are an existing client, so this is a friendly suggestion from their web team, not a sales pitch):
- UK English, warm and plain, no sales jargon, no exclamation marks, no buzzwords.
- 2 or 3 short paragraphs separated by a blank line. No greeting and no sign-off (those are added separately).
- Open with what you noticed or the idea, e.g. "We were just looking over your website and had an idea…" or "While looking at your site, we noticed…".
- Say "your website", never the web address. Only mention things you have confirmed (don't assume they have Google reviews, a booking system, social accounts, etc.).
- Say briefly why it would help them, in their terms (more enquiries, bookings, trust, fewer phone calls…).
- End by offering to do it and, subtly, to send an estimate, e.g. "If you'd like us to set this up, we can send over a quick estimate." or "Would you like us to put an estimate together?". Never mention prices. Use "we" for ICL.

When you have finished researching, call save_research exactly once with everything. Do not write the answer as text.`;

// One research run. Returns the save_research input plus usage, or throws.
export async function researchClient({ name, websites = [], notes = "", findings = null, quick = false, deadlineMs = 52000 }) {
  const client = new Anthropic();
  const started = Date.now();
  const facts = findings ? JSON.stringify(findings).slice(0, 4000) : "none yet";
  const messages = [{
    role: "user",
    content: `Client: ${name}\nWebsite on file: ${websites.join(", ") || "none"}\n${notes ? `Our notes: ${notes}\n` : ""}Automated findings from their website: ${facts}\n\nResearch this client and save your ideas.`,
  }];
  const webSearch = /haiku/i.test(MODEL)
    ? { type: "web_search_20250305", name: "web_search", max_uses: quick ? 2 : 5, user_location: { type: "approximate", country: "GB" } }
    : { type: "web_search_20260209", name: "web_search", max_uses: quick ? 2 : 5, user_location: { type: "approximate", country: "GB" } };
  const usage = { input: 0, output: 0, searches: 0 };
  for (let turn = 0; turn < 4; turn++) {
    const left = deadlineMs - (Date.now() - started);
    if (left < 5000) throw new Error("Research took too long; try again.");
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: [webSearch, SAVE_TOOL],
      tool_choice: { type: "auto" },
      output_config: { effort: quick ? "low" : "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    }, { timeout: left, maxRetries: 0 });
    usage.input += response.usage?.input_tokens || 0;
    usage.output += response.usage?.output_tokens || 0;
    usage.searches += response.usage?.server_tool_use?.web_search_requests || 0;
    if (response.stop_reason === "refusal") throw new Error("The research request was declined.");
    const saved = response.content.find((b) => b.type === "tool_use" && b.name === "save_research");
    if (saved) return { ...saved.input, model: response.model, usage, researchedAt: new Date().toISOString() };
    if (response.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: response.content }); continue; }
    // Finished without saving: ask once more, plainly.
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: "Please call save_research now with what you found." });
  }
  throw new Error("The research did not finish; try again.");
}

// Rough cost of one run, for the usage line (list prices; web search $10 per 1,000).
export function researchCost(u, model = MODEL) {
  const rates = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] }[model] || [4, 20];
  return (u.input * rates[0] + u.output * rates[1]) / 1e6 + u.searches * 0.01;
}
