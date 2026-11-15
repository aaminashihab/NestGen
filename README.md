# NestGen — LabelProof

*Verify Before You Print.* AI-assisted bilingual food-label verification for the UAE food market.

This is the MVP website: a single responsive landing page that follows the LabelProof pitch deck
(colours, typography, logo and packaging mock-ups) plus a working pilot registration backend.

## Run it

Requires Node.js 18+ (no npm packages to install).

```bash
npm start
```

Open http://localhost:3000.

## Pilot registrations

`POST /api/pilot` validates each submission (required fields, email format, allowed options,
consent, honeypot, 5 submissions / 10 minutes per IP) and appends it to
`data/pilot-registrations.jsonl`. The success message is shown only after the server confirms the write.

### Integrations still to configure

| Setting | Purpose |
|---|---|
| `PILOT_WEBHOOK_URL` | Optional. Forwards each registration as JSON to a webhook (Zapier, Make, Slack workflow, Google Apps Script → Sheet, CRM). Not set by default. |
| `ADMIN_TOKEN` | Optional. Enables `GET /api/pilot/export` (JSON, or `?format=csv`) with header `Authorization: Bearer <token>`. Disabled by default. |
| `PORT`, `DATA_DIR` | Server port (default 3000) and storage folder (default `./data`). |

No email notification is sent yet. When you deploy to a host with an ephemeral filesystem
(e.g. most serverless platforms), set `PILOT_WEBHOOK_URL` or mount a persistent `DATA_DIR`,
otherwise stored registrations can be lost on redeploy.

Footer contact details (`hello@[your-domain]`, LinkedIn, WhatsApp) are placeholders in
`public/index.html`.

## What is and isn't real

- The dashboard, packaging and findings are **fictional demonstration data**; there is no live AI
  verification engine.
- Features are labelled **Planned**.
- LabelProof provides preliminary verification support, not regulatory certification.

## Files

- `public/index.html`: page markup (all sections)
- `public/styles.css`: brand system and responsive layout
- `public/app.js`: navigation, demo interactions, form submission
- `public/assets/logo-mark.svg`: logo icon, redrawn as vector from the deck
- `server.js`: static server and registration API
