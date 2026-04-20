# Michelangelo

Michelangelo is a browser-first research workspace. A user brings their own
OpenAI key, chats with a research assistant, and inspects structured artifacts
(summary, sources, insights, caveats) alongside the conversation. Over time the
workspace accumulates a concept memory so follow-up turns and future sessions
can surface cross-domain connections.

## About this project

Michelangelo is a **nonprofit, open-source** project released under the
**Red Lemon** label — a personal, nonprofit brand of **Joydeep Banerjee**.

- Red Lemon is a label for nonprofit creative and research projects.
  It is not a company, has no commercial activity, and does not generate revenue.
- The project is maintained as a personal, non-commercial effort and released
  to the public as free software under the MIT License.
- All code in this repository is released under the MIT License (see
  `LICENSE`). Anyone is free to use, modify, fork, and redistribute it.
- If you would like to contribute, please open a pull request or issue.

If you represent an organization that would like to use or build on this
work, you are welcome to do so under the terms of the MIT License. The author
is not offering paid work, consulting, or services through this project.

## Local Development

```bash
npm install --prefix apps/web
npm --prefix apps/web run dev
```

Open `http://localhost:3000`, enter an OpenAI API key, and start a research
pass. For local smoke testing without model calls, use `sk-mock` as the key
or set `MOCK_MODEL=true`.

The app stores:

- sessions,
- messages,
- artifacts (summary / sources / insights / caveats, one row per type),
- compact turn summaries,
- concepts and concept mentions (the cross-domain memory).

If `POSTGRES_URL` is unset, the app falls back to in-memory storage for
local development. Cross-session concept retrieval requires Postgres (and
optionally the `pgvector` extension for embedding-based similarity; label
matching is used as a fallback).

## Docker Local Test

```bash
docker compose up --build
```

This starts the Next.js app and a local Postgres database with mocked model
mode enabled.

## Vercel Deployment

Create the Vercel project with `apps/web` as the project root. Configure:

```bash
POSTGRES_URL=<vercel-postgres-connection-string>
OPENAI_MODEL=gpt-5.2
MOCK_MODEL=false
```

Keep the deployment private with Vercel Deployment Protection during MVP
testing. The app does not persist user API keys server-side; browser keys
are stored in `localStorage` only.

## License

MIT — see [`LICENSE`](./LICENSE).
