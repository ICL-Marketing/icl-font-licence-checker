# Hosting ICL Sales on Google Cloud Run

Cloud Run builds the `Dockerfile` in this repo and redeploys on every push to
`main`, like Vercel did. Its free tier each month is 180,000 vCPU-seconds
(50 hours), 360,000 GiB-seconds and 2 million requests, against Vercel
Hobby's 4 hours of CPU.

## One-off setup (about 20 minutes, all in the browser)

1. **Google Cloud project**: go to <https://console.cloud.google.com>, sign in
   with the ICL Google account, and create a project called `icl-sales`.
   Add a billing account when asked. A card is needed, but nothing is charged
   inside the free tier.
2. **Budget alert**: Billing → Budgets & alerts → Create budget → £1 for the
   `icl-sales` project, with email alerts at 50% and 100%.
3. **Copy the settings from Vercel**: Vercel → the project → Settings →
   Environment Variables. Note each name and value (`CHECKER_PASSWORD`,
   `SESSION_SECRET`, the `KV_…` / `UPSTASH_…` / `REDIS_URL` ones and the
   API keys).
4. **Create the service**: Cloud Run → Deploy container → Service →
   **Continuously deploy from a repository** → Set up with Cloud Build:
   - Repository provider: GitHub. Sign in and pick
     `ICL-Marketing/icl-font-licence-checker`.
   - Branch: `^main$`. Build type: **Dockerfile**, source `/Dockerfile`.
5. **Service settings**:
   | Setting | Value |
   |---|---|
   | Service name | `icl-sales` |
   | Region | `europe-west1 (Belgium)` (in the free tier) |
   | Authentication | **Allow public access** (the app has its own sign-in) |
   | Billing | Request-based |
   | Minimum instances | 0 |
   | Maximum instances | 2 |
   | Container port | 8080 |
   | Memory / CPU | 2 GiB / 1 |
   | Request timeout | 300 seconds |
   | Variables & secrets | add every variable from step 3 |
6. Click **Create**. The first build takes about 5 minutes. The address looks
   like `https://icl-sales-XXXX.europe-west1.run.app`.

## After that

- Every push to `main` rebuilds and redeploys automatically.
- Usage: Cloud Run → `icl-sales` → Metrics. Billing → Reports shows the cost,
  which stays at £0 inside the free tier.
- The container image is kept in Artifact Registry (0.5 GB free). To keep it
  free: Artifact Registry → the repository → Cleanup policies → keep the 2
  most recent versions.
