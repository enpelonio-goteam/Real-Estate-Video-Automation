# Real Estate Video Automation API

Vercel serverless API for assembling Shotstack timeline payloads from normalized inputs.

## Deploy to Vercel

1. Install the Vercel CLI: `npm i -g vercel`
2. From this directory run: `vercel`
3. Follow the prompts (link to an existing project or create a new one).

Or connect this repo in the [Vercel dashboard](https://vercel.com) and deploy from Git.

## Endpoint

**POST** `/api/shotstack/assemble`

Request body (JSON):

- **inputs** (required): `brand_logo_url`, `property_address_url`, `avatar_intro_video`, `avatar_cta_video`, `walkthrough_voiceover`, `walkthrough_footages`, `transcription`
- **alignment** (optional): e.g. `{ segment_windows: [...] }` for segment timing
- **constants** (optional): override timing constants (e.g. `OPEN_LOGO_LENGTH`, `WALK_XFADE`)

Responses:

- **200**: `{ ok: true, payload, debug }` — `payload` is the Shotstack-ready timeline
- **400**: Validation errors from `normalizeInputs`
- **422**: Validation errors from `validateShotstack` (with `debug`)
- **500**: Internal error

## Local dev

No dependencies required. To run locally with Vercel CLI:

```bash
vercel dev
```

Then `POST http://localhost:3000/api/shotstack/assemble` with a JSON body.
