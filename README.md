# Know My Health

**Patients tell stories. Doctors want data.** Know My Health translates between the two.

A patient taps a body map to show where it hurts, then tells what's happening in their own words, typed or spoken. The app turns that into a clinician-ready record they can bring to their visit:

- **For you:** their story reflected back in plain language
- **Clinical note:** chief complaint, History of Present Illness, and OPQRST
- **Story → data:** the patient's own phrases next to their clinical equivalents
- **Doctor's questions:** the follow-up questions a clinician is likely to ask, which the patient can answer ahead of time
- **Between visits:** a dated log of episodes, so nothing gets lost between appointments
- **FHIR R4 record:** a portable Bundle any FHIR-capable system can read
- **Printable PDF summary** for the patient or a caregiver to hand to the doctor

Built by Teresa Younkin, Mosaic Life Tech.

## Design principles

1. **It records. It never diagnoses or recommends treatment.** The model is instructed to document only what the patient reported, flag what wasn't reported, and stop there. It names no conditions, interprets no symptoms, and offers no care advice. The clinical relationship stays with the clinician.
2. **The patient's voice is preserved.** Their verbatim story travels with the clinical translation, in the app and on the printed summary.
3. **Clinically specific capture.** The body map goes down to individual fingers, toes, and joints (MCP, PIP, DIP, MTP, CMC), with laterality and a 0–10 pain score for each area.
4. **Interoperable output.** The FHIR Bundle has one Observation per marked area (SNOMED CT body site, LOINC 72514-3 pain severity, a laterality component) plus the history as a DocumentReference (LOINC 10164-2).
5. **Safe by construction.** The API key never reaches the browser. The server builds the prompt itself, so the endpoint can't be used as a general-purpose AI proxy. Nothing the patient types is logged or stored on the server.

## How it works

```
index.html            The whole app: body map, story, results, log, PDF, FHIR (no build step)
api/translate.js      Serverless function: validates input, builds the prompt, calls Claude, returns JSON
```

The browser sends only the story text, the selected body areas, and whether to include the sample record. `api/translate.js` checks the request's origin, applies rate limits, builds the prompt server-side, and calls the Anthropic Messages API with your key.

The between-visit log is stored only in the patient's own browser (localStorage). The PDF is generated in the browser with jsPDF.

## Deploy (about 15 minutes)

### 1. Put the code on GitHub
Create a new repository named `know-my-health` on github.com and upload these files (drag and drop works). Leave `.env.example` as a template; never commit a real key.

### 2. Get an Anthropic API key and cap spending
1. Sign in at [console.anthropic.com](https://console.anthropic.com) and create an API key.
2. Under **Billing → Limits**, set a monthly spend limit (for example $10). This is the hard backstop for a public demo.

### 3. Deploy on Vercel
1. Sign in at [vercel.com](https://vercel.com) with GitHub and choose **Add New → Project**, then import `know-my-health`.
2. Framework preset: **Other**. No build command is needed.
3. Under **Environment Variables**, add:

| Name | Value | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | your key | Yes |
| `ALLOWED_ORIGINS` | your site URL(s), comma-separated, e.g. `https://know-my-health.vercel.app,https://demo.mosaiclifetech.com` | Recommended |
| `MODEL` | defaults to `claude-haiku-4-5`; any current Claude model ID from the [models page](https://docs.claude.com/en/docs/about-claude/models) | No |
| `RATE_PER_HOUR` | translations per visitor per hour (default 8) | No |
| `DAILY_CAP` | translations per day per server instance (default 300) | No |

4. Click **Deploy**. Every later push to GitHub redeploys automatically.

### 4. Optional: use your own domain
In Vercel, open **Project → Settings → Domains** and add, for example, `demo.mosaiclifetech.com`. Vercel shows the DNS record to add at your domain registrar. Add the new address to `ALLOWED_ORIGINS`, then redeploy.

## Cost

Each translation is one request: a short system prompt, the story, and a capped response (1,500 tokens maximum). On the default fast model, that's typically about a cent or less. The per-visitor rate limit, the daily cap, and your Anthropic spend limit keep a public demo predictable.

## Privacy and safety notes

- This is a demonstration, not a medical device, and it is **not HIPAA-compliant**. The page tells visitors not to rely on it for medical decisions. You may also want to ask them not to enter identifying information.
- Story text passes through Vercel and the Anthropic API to produce the translation. The function writes no request content to logs.
- The sample health record is fictional and lives on the server, so a visitor can't substitute their own.
- SNOMED CT and LOINC codes are illustrative and should be validated before any clinical use.
- Rate limits are kept in memory and reset when the function restarts. For stricter limits, add a store such as Vercel KV or Upstash Redis.

## Local development

```bash
npm i -g vercel
cp .env.example .env.local   # add your key
vercel dev                   # serves index.html and /api/translate at http://localhost:3000
```

## Also runs inside Claude

The same `index.html` works as a Claude artifact. There it uses the viewer's own Claude account instead of `/api/translate`, and falls back to a worked example when Claude isn't available.
