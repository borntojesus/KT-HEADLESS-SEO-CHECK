# Deploy — KT-HEADLESS-SEO-CHECK

- **Target:** {{homelab (Coolify CT 210 / Caddy CT 213 / LXC) | Vercel (client-prod, prebuilt only) | Netlify (legacy)}}
- **URL:** TODO
- **Build:** `{{pnpm build}}`
- **Deploy command / trigger:** {{GHA workflow file | vercel deploy --prebuilt | coolify webhook}}
- **Env:** {{where secrets live: GH Actions secrets / Coolify env / 1Password item}}
- **DNS / tunnel:** {{CF zone + record, tunnel ingress if homelab}}

> Rules: build locally or in GHA — NEVER remote Vercel builds. Push only at task end.
