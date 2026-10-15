# Contact finder APIs: findings and how they are wired in

Written 2026-10-14. Notes behind `lib/enrich.js`: what each provider claims to do, what was guessed, and what still needs checking with a real key.

## 0. Read this first

- **Nothing here was tested against a live API.** The sandbox has no DNS for these hosts and there are no keys. Everything below comes from web search summaries of each vendor's docs, plus memory where marked.
- Each item has a **confidence** tag: `sourced` (seen in a search result that cites the vendor docs), `memory` (written from recollection, check it), `guess` (probably wrong, verify).
- The code is in `lib/enrich.js` (uncommitted when this was written). It reads responses tolerantly (`phonesIn`, `emailsIn` walk any JSON), so a wrong field name usually still finds the number. Verify each provider with real keys before trusting it.

## 1. The goal

Chris wants **many free tiers stacked**: when one finder runs out of credits the next one is used, so there are always credits. Contact is by **WhatsApp**, so the valuable result is a **UK mobile number (07...)**. Emails are secondary (shown as backup, optionally verified).

The user's table (from a screenshot):

| Tool | Free credits or allowance | API access | Best use |
|---|---|---|---|
| Prospeo | 100 credits per month | Yes, limited on free plan | Verified business emails and mobile numbers |
| Apollo.io | Free plan with limited credits | Available, endpoint access and credit usage vary | Searching for companies and decision makers |
| Tomba | 75 free API credits on signup, plus a free search allowance | Yes | Email discovery, verification and company data |
| Snov.io | Free allowance, with limits on usage | Depends on feature and plan | Email finding, verification, automated outreach |
| Hunter.io | 50 credits per month | Yes | Finding emails from company domains |
| ZeroBounce | 100 free monthly verification credits and 10 email finder credits | Yes | Verifying contact lists, reducing bounces |
| Dropcontact | 50 free email credits | Yes | Enriching existing contact lists |
| Lusha | Free plan with limited credits | API access restricted by plan | Professional contact details and phone numbers |

Note a discrepancy: a search result for Tomba said the free plan is **25 searches and 50 verifications a month**, while the user's table says 75 credits on signup. Treat the cap as unknown until the account page is checked.

## 2. Which tools can give a mobile (the WhatsApp question)

| Tool | Mobile or phone via API | Email | People at a company | Notes |
|---|---|---|---|---|
| Prospeo | **Yes** (`enrich_mobile`, costs 10 credits) | Yes | search endpoints exist | Best fit. 100 credits is about 10 mobiles a month |
| Lusha | **Yes** (phone numbers with type, confidence, do not call flags) | Yes | company endpoints | Free credits small; API restricted by plan |
| Apollo | Only **asynchronously to a webhook** | Yes | Yes | Cannot return a mobile in one request. Company main phone is available from organization enrich (memory) |
| Dropcontact | Possibly (`phone` fields unconfirmed) | Yes | no | Asynchronous: submit then poll |
| Tomba | Maybe (`phone_number` on some email records, memory) | Yes | Yes (domain search) | Mostly email |
| Hunter | Maybe (`phone_number` on some records, memory) | Yes | Yes (domain search) | Mostly email |
| Snov.io | No known phone API | Yes | Yes (domain emails) | Email only |
| ZeroBounce | No | Verifies only | no | Verification, not discovery |

Conclusion: **Prospeo and Lusha are the two that matter for WhatsApp.** Everything else is for names, titles and backup emails.

## 3. Per provider details

### 3.1 Prospeo

- **Endpoint (sourced):** `POST https://api.prospeo.io/enrich-person`. Host `api.prospeo.io`, HTTPS only, **every endpoint accepts only POST**, `Content-Type: application/json`.
- **Auth (sourced):** header `X-KEY: <api key>`.
- **Body (sourced):** top level booleans `only_verified_email` and `enrich_mobile`, with the person under `data`: `first_name`, `last_name`, `company_website` (also `company_name`, `company_linkedin_url`, `email`, `person_id`).
- **Matching rules (sourced):** needs a name plus a company identifier, or a LinkedIn URL, an email or a person_id. Docs advise against matching on company name alone, so pass the **domain** when known.
- **Cost (sourced):** standard match 1 credit, match **with mobile 10 credits**, no charge when there is no match.
- **Errors (sourced):** JSON always has an `error` boolean. HTTP 200 success, 400 error, 401 invalid key, 429 rate limited.
- **Response fields (memory, verify):** `person.email.email`, `person.mobile.mobile` (also `mobile_international`, `mobile_national`), `person.current_job_title`, `person.linkedin_url`, `person.full_name`. Error body probably has `error_code` such as `INSUFFICIENT_CREDITS`, `NO_MATCH`, `RATE_LIMITED`, `INVALID_API_KEY`.
- **Credit check (memory):** `POST /account-information` returning `remaining_credits`.
- **Other endpoints (sourced):** `POST /bulk-enrich-person` (up to 50 records per call).
- **Docs:** https://prospeo.io/api-docs/authentication , https://prospeo.io/api-docs/enrich-person , https://prospeo.io/api-docs/bulk-enrich-person
- **Wired as:** `PROVIDERS.prospeo.person`, charge 10 when a phone returns, 1 for email only. Env `PROSPEO_API_KEY`. Default cap 100.

### 3.2 Lusha

- **Endpoint (sourced):** `GET https://api.lusha.com/v2/person`. The old v1 person API was deprecated by **14 January 2025**. A `POST /v2/person` bulk variant exists.
- **Auth (sourced via a Clay community guide):** header named `api_key` with the key as the value.
- **Inputs (sourced):** first name plus last name with company name or company domain, or email, or LinkedIn URL.
- **Response (partly sourced):** v2 includes metadata on phone numbers such as type, confidence and Do Not Call flags. Exact shape (memory): `contact.data.phoneNumbers[].number`, `phoneType`, `doNotCall`, and `emailAddresses[].email`.
- **Query parameter names (memory, verify):** `firstName`, `lastName`, `companyName` or `companyDomain`. The code sends several aliases because unknown params are normally ignored.
- **Credit check (guess):** `GET /account/usage`. The code tolerates a 404 and reports "key set".
- **Errors:** unknown exact codes. Code treats 402 or messages matching credits/quota as out of credits, 401/403 as key problem, 429 as rate limit.
- **Docs:** https://docs.lusha.com/tutorials/person-api-v1-deprecation , https://docs.lusha.com/guides/advanced-topics/new-getting-started , https://community.clay.com/x/support/m102x62y3856/how-do-i-connect-lusha-to-clay-via-api
- **Wired as:** `PROVIDERS.lusha.person`. Env `LUSHA_API_KEY`. Default cap 40 (guess).

### 3.3 Apollo.io

- **Person match (sourced):** `POST https://api.apollo.io/api/v1/people/match`. Bulk: `POST /api/v1/people/bulk_match` (up to 10 people).
- **Auth (sourced):** header `X-Api-Key: <key>`.
- **Phones (sourced):** off by default. `reveal_phone_number` and `reveal_personal_emails` turn them on. **A `webhook_url` is mandatory for phone reveals**; Apollo returns the main response synchronously and sends the phone numbers to the webhook later (can take several minutes). Therefore the adapter **does not return mobiles**. A GDPR region person's personal email is not revealed.
- **Credits (sourced):** reveals consume credits per plan; Apollo says credits are only consumed when data is returned.
- **People search (memory):** `POST /api/v1/mixed_people/api_search` (newer) or `/mixed_people/search` (older). Returns names and titles, not emails or phones. The code tries the first and falls back on 404.
- **Company phone (memory):** `GET /api/v1/organizations/enrich?domain=` with `organization.primary_phone.number` and `organization.phone`. Used only as a last resort when no site phone and no person phone exists.
- **Health check (memory):** `GET /api/v1/auth/health`.
- **Docs:** https://docs.apollo.io/docs/retrieve-mobile-phone-numbers-for-contacts , https://docs.apollo.io/reference/people-enrichment
- **Possible upgrade:** accept the webhook (a `/api/apollo-webhook` route) and store revealed phones on the lead later. Not built.
- **Wired as:** `person`, `domain`, `company`. Env `APOLLO_API_KEY`. Default cap 50 (guess).

### 3.4 Snov.io

- **Auth (sourced):** `POST https://api.snov.io/v1/oauth/access_token` with `grant_type=client_credentials`, `client_id`, `client_secret` (from account settings). Token lasts **3600 seconds**. Use `Authorization: Bearer <token>`.
- **Domain emails (sourced):** `GET https://api.snov.io/v2/domain-emails-with-info` with `domain`, `type` (all, personal, generic), `limit`; up to 100 emails per response. **1 credit per 10 emails**, no charge if none returned.
- **Company info search (sourced):** `POST /v2/domain-search/start` returns a task hash and result link (two step). 1 credit per POST. Not used.
- **Balance (unconfirmed):** `GET /v1/get-balance` is written from memory; the search did not confirm it.
- **Phones:** no phone endpoint known.
- **Docs:** https://snov.io/api
- **Wired as:** `domain` only. Env `SNOV_CLIENT_ID` and `SNOV_CLIENT_SECRET`. Default cap 50 (guess). The access token is fetched on every call (could be cached for an hour).

### 3.5 Tomba

- **Base and auth (sourced):** `https://api.tomba.io/v1`, headers `X-Tomba-Key` and `X-Tomba-Secret` (key looks like `ta_...`, secret `ts_...`). Account info: `GET /v1/me`. Client libraries treat any non 200 as an error.
- **Domain search (sourced):** returns the email addresses found for one domain (`/domain-search?domain=`).
- **Email finder (sourced):** generates or retrieves the most likely email from a domain plus first and last name (`/email-finder?domain=&first_name=&last_name=`).
- **Verifier (memory):** `GET /email-verifier/{email}`.
- **Response fields (memory):** `data.emails[]` with `email`, `first_name`, `last_name`, `position`, `department`, `phone_number`, `linkedin`, `score`; `data.organization`.
- **Free plan (sourced, conflicts with the user's table):** 25 searches and 50 verifications a month.
- **Docs:** https://developer.tomba.io (official reference, not reachable from the sandbox), client libs at https://hexdocs.pm/tomba/Tomba.html
- **Wired as:** `domain`, `person` (email finder), `verify`. Env `TOMBA_API_KEY` and `TOMBA_API_SECRET`. Default cap 75.

### 3.6 Hunter.io

- **Endpoints (high confidence, long standing):** `GET https://api.hunter.io/v2/domain-search`, `/email-finder`, `/email-verifier`, `/email-count` (free), `/account` (free). Key as `api_key` query parameter.
- **Fields:** `data.emails[]` with `value`, `first_name`, `last_name`, `position`, `department`, `confidence`, `linkedin`, `phone_number`, `verification.status`. Out of searches returns HTTP 429.
- **Existing behaviour from the original code:** only paid for leads worth pitching, used `email-count` as a free pre check, cached results for 60 days. The multi provider version drops the free pre check (not provider neutral).
- **Docs:** https://hunter.io/api-documentation
- **Wired as:** `domain`, `person`, `verify`. Env `HUNTER_API_KEY`. Default cap 50.

### 3.7 Dropcontact

- **Submit (sourced):** `POST https://api.dropcontact.com/v1/enrich/all`. Asynchronous: the response has a `request_id` and a credits remaining field (`credits_left`).
- **Poll (sourced):** `GET https://api.dropcontact.com/v1/enrich/all/{request_id}` until `success` is true. Until ready it returns `success: false` with a `reason`. `forceResults=true` returns partial results.
- **Auth (unconfirmed):** third party connector docs list only Accept and Content-Type. An older batch endpoint (`https://api.dropcontact.io/batch`) used header `X-Access-Token`. The code uses `X-Access-Token`. **Verify.**
- **Phone fields:** not described in any result. The code reads `mobile_phone`, `phone`, `mobile`, then walks the JSON.
- **Timing risk:** enrichment can take well over 15 seconds. The adapter polls 5 times (1.5s then 3s gaps, about 15 seconds) and then gives up with "still working". A function limit is 50 seconds (`maxDuration`). A better design is to store `request_id` on the lead and poll later. Not built.
- **Docs:** https://developer.dropcontact.com/ (not reachable here); connector summary at https://www.withone.ai/knowledge/dropcontact
- **Wired as:** `person` only. Env `DROPCONTACT_API_KEY`. Default cap 50.

### 3.8 ZeroBounce

- **Validate (sourced):** `GET https://api.zerobounce.net/v2/validate` with `api_key` and `email` (optional `ip_address`). Response has `status` (valid, invalid, catch-all, unknown, spamtrap, abuse, do_not_mail) and flags such as disposable and role address.
- **Credits (sourced):** `GET https://api.zerobounce.net/v2/getcredits?api_key=`. Returns the balance; **`-1` means the key is invalid**. Regional hosts exist (US and EU variants).
- **Batch (sourced):** `POST /v2/validatebatch`.
- **Email finder:** no endpoint confirmed (the user's table says 10 finder credits). Not implemented.
- **Docs:** https://www.zerobounce.net/email-validation-api-quickstart/ , https://www.zerobounce.in/docs/email-validation-api-quickstart/v2-credit-balance
- **Wired as:** `verify` only. Env `ZEROBOUNCE_API_KEY`. Default cap 100.

## 4. Failover design (as built in `lib/enrich.js`)

```
lookup kind  ->  ordered list  ->  first usable provider that returns something wins
person    : prospeo, lusha, dropcontact, apollo, tomba, hunter, getprospect  (stops at first UK mobile)
domain    : tomba, hunter, snov, getprospect, apollo             (stops at first provider that lists people)
byName    : hunter                                               (no website on file; can turn up the domain)
company   : apollo                                               (main phone, last resort)
verify    : zerobounce, bouncer, abstract, mailboxlayer, hunter, tomba
            (sorted by credits left, fullest account first)
```

- A provider is **skipped** when: no key, marked out, or its monthly soft cap is reached.
- Errors are classified by `classify()` from HTTP status and body text: `credits` (402, or text like insufficient, quota, no credits, limit reached), `auth` (401, 403, invalid key), `rate` (429, timeouts), other.
- `credits` marks the provider out **until the end of the month**; `auth` for **4 hours**. State is stored with `cacheSet` in Redis when a store exists, otherwise in memory (resets on restart and is per instance on Vercel, so **connect Redis** for real failover memory).
- Usage counters per provider per month (`finder:<id>:<YYYY-MM>` via `counterIncr`). Prospeo charges 10 for a mobile, others 1. Caps are soft; override with `<PROVIDER>_MONTHLY_CAP` (set 0 for unlimited on paid plans).
- `findContacts()` (in `lib/leads.js`) calls: `searchDomain` once, `enrichPerson` for the top two decision makers, `companyPhone` only if nothing else gave a number, `verifyEmail` for any new email. A human readable trail ("Prospeo: out of credits · Lusha: number found") is returned as `hunterNote`.
- Credit budget per lead: up to about 1 domain search + 2 person lookups (each possibly walking several providers) + 1 verify. Leads are only enriched when `likelihood` is not Low (`useHunter: provisional !== "Low"`), or on a manual click.

### Env vars

| Provider | Variables |
|---|---|
| Prospeo | `PROSPEO_API_KEY` |
| Lusha | `LUSHA_API_KEY` |
| Apollo | `APOLLO_API_KEY` |
| Snov.io | `SNOV_CLIENT_ID`, `SNOV_CLIENT_SECRET` |
| Tomba | `TOMBA_API_KEY`, `TOMBA_API_SECRET` |
| Hunter | `HUNTER_API_KEY` |
| Dropcontact | `DROPCONTACT_API_KEY` |
| ZeroBounce | `ZEROBOUNCE_API_KEY` |
| Optional caps | `PROSPEO_MONTHLY_CAP`, `LUSHA_MONTHLY_CAP`, ... (0 means unlimited) |

## 5. Verification checklist (do this once keys exist)

1. For each provider call `POST /api/finders {id}` (Test button, once the Settings UI exists). It uses a free account endpoint where one exists. Dropcontact and (probably) Lusha have no free check, so they only prove themselves on a first lookup.
2. Run one real lookup with a known person (a friend who is fine being looked up) per provider and **log the raw response**. Fix the parsers in `lib/enrich.js` to match. Expect to adjust: Prospeo mobile path, Lusha query parameters and phone path, Dropcontact auth header and phone fields, Tomba fields, Snov list key (`emails`, `data.emails`, `data`).
3. Force each failure and confirm failover: wrong key (401), exhausted credits (402 or provider specific), no match (should not mark the provider out), rate limit (should not mark out for the month).
4. Confirm the **cost** of Prospeo mobile enrichment on the real plan. 10 credits per mobile means the free 100 credits is only about 10 numbers a month, so Prospeo should probably only run for High likelihood leads. Consider a per provider `minLikelihood`.
5. Check UK data quality: many small UK businesses are not in these databases, so expect low hit rates for sole traders and tiny shops. Company website phone numbers (already scraped by `findPhones`) will often be the best source. The finders mostly help with directors of slightly larger firms.

## 6. Known gaps and risks

- **UI is unfinished:** the manual "find numbers" button in the lead drawer is hidden (it checks `l.hunterOnFile > 0`, now always null). The stats line under the buttons still reads `cfg.hunterUsage` (removed). Settings has no finders section yet. See `HANDOFF.md` section 7.
- **Legal and consent:** these tools return personal data. UK GDPR and PECR matter for B2B outreach: corporate subscribers are lighter, but sole traders count as individuals. Keep an opt out path (the app has "Do not contact"). WhatsApp messages to people who have not asked for them may breach WhatsApp's terms if sent in bulk; keep volumes low and personal.
- **Apollo webhook** would unlock mobiles but needs a public route and storage.
- **Dropcontact** may exceed function time; consider storing `request_id` and polling later.
- **Memory only failover state** without Redis.
- Costs can move: free tiers change. Re-check pricing pages before relying on any number in section 1.

## 7. Sources used (search summaries, not fetched pages)

- Prospeo: https://prospeo.io/api-docs/authentication , https://prospeo.io/api-docs/enrich-person , https://prospeo.io/api-docs/bulk-enrich-person
- Lusha: https://docs.lusha.com/tutorials/person-api-v1-deprecation , https://docs.lusha.com/guides/advanced-topics/new-getting-started , https://community.clay.com/x/support/m102x62y3856/how-do-i-connect-lusha-to-clay-via-api
- Apollo: https://docs.apollo.io/docs/retrieve-mobile-phone-numbers-for-contacts , https://docs.apollo.io/reference/people-enrichment , https://docs.apollo.io/docs/bulk-people-enrichment
- Dropcontact (third party): https://www.withone.ai/knowledge/dropcontact , https://pipedream.com/apps/dropcontact
- Tomba: https://hexdocs.pm/tomba/Tomba.html , https://pipedream.com/apps/tomba/integrations/email
- Snov.io: https://snov.io/api , https://snov.io/knowledgebase/how-to-use-snov-io-api/amp
- ZeroBounce: https://www.zerobounce.net/email-validation-api-quickstart/ , https://www.zerobounce.in/docs/email-validation-api-quickstart/v2-credit-balance
- Hunter: https://hunter.io/api-documentation (from memory, not searched)

## 8. The five added later, and the caps (written 2026-10-15)

Added after the first eight, same pattern, same `sourced`/`memory` caveats. None tested live.

| Provider | Kind | Endpoint used | Auth | Confidence |
|---|---|---|---|---|
| GetProspect | person, domain | `GET https://api.getprospect.com/public/v1/email/find` and `/email/search` | `apiKey` query parameter | memory, verify |
| Bouncer | verify | `GET https://api.usebouncer.com/v1.1/email/verify`, credits at `/v1.1/credits` | header `x-api-key` | memory, verify |
| Abstract API | verify | `GET https://emailvalidation.abstractapi.com/v1/` | `api_key` query parameter | sourced |
| MailboxLayer | verify | `GET https://apilayer.net/api/check` | `access_key` query parameter | sourced |

Skrapp.io was written and then removed at Chris's request before the first commit.

**Caps, so nothing can ever bill.** Every provider has `free` (what the plan gives a month) and
`cap` (where this app stops), and `cap` is deliberately a few credits short of `free`. Three
guards, all in `lib/enrich.js`:

1. Per provider, per month. Every call the app makes is counted, including a call that found
   nothing and a call that failed with an unclassified error, because either may still charge.
   A call is refused when the count plus the call's **worst case** cost would pass the cap, so a
   10-credit Prospeo mobile is refused with 9 credits left rather than tipping over.
2. Per lead. `LOOKUP_BUDGET` (14 credits, `FINDER_LOOKUP_BUDGET` to change it) is shared by every
   finder asked about one lead, so one lead can never drain a month.
3. Out of credits. A `credits` error parks that provider until the month turns over; an `auth`
   error parks it for four hours. The marks live in Redis, with a memory fallback.

`<PROVIDER>_MONTHLY_CAP` raises a cap on a paid plan. Only a literal `0` means no cap; anything
unreadable falls back to the safe default rather than becoming unlimited. Without Redis the counts
are per server instance and reset on restart, which Settings says plainly: connect the store
before adding keys.

## 9. The directories Chris asked about (Thomson Local, Yelp, Kompass, Scoot)

Searched 2026-10-15, nothing fetched from a vendor developer portal, so all of this is weak.

- **Thomson Local**: no sign of a public API. It has sold bulk data for direct mail and
  telemarketing since about 2010. Only unofficial scrapers exist (an Apify actor). Not wired in.
- **Yelp (Fusion API)**: a real documented API, but third-party sources disagree sharply on
  whether a free tier still exists (one says 5,000 calls a day free, another lists paid plans from
  $7.99 per 1,000 calls with a 30-day trial, another says no free tier at all). Check Yelp's own
  pricing page before building anything. Returns business name, address, phone, rating and review
  count: no email, no named person, and phones are landlines or switchboards, not mobiles.
- **Kompass**: nothing found on developer access. It reads as an enterprise data-licensing sale
  rather than a self-serve API.
- **Scoot Network**: nothing found. It appears as a *destination* for listings pushed out by Yext,
  which suggests data goes in rather than out.

Verdict: none of the four is worth wiring in for the WhatsApp goal. Google Maps (already in the
app) gives the same listing fields with a real free allowance, and none of these four returns a
mobile number or a named decision maker. Yelp is the only one worth a second look, and only if
its own pricing page shows a usable free tier.
