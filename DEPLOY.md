# Deploy: KT-HEADLESS-SEO-CHECK

- **Target:** npm registry. Nothing is hosted: no server, no container, no DNS.
- **URL:** https://www.npmjs.com/package/headless-seo-check and https://github.com/borntojesus/KT-HEADLESS-SEO-CHECK (public)
- **Build:** `npm run build` (runs inside `npm test` and `prepublishOnly`)
- **Release:** manual, from the Mac, by Dmytro:
  1. `npm test` (offline, must be green)
  2. bump `version` in `package.json`, commit, `git tag vX.Y.Z`
  3. `npm publish` (the `prepublishOnly` script runs the tests again; `files` ships only `dist`, README, LICENSE)
  4. `git push origin main --tags`
- **First release:** create the public GitHub repo `borntojesus/KT-HEADLESS-SEO-CHECK` (gh user `borntojesus`), add `origin`, push. No remote is configured yet.
- **Env / secrets:** npm login on the Mac (`npm login`); store the npm token in 1Password before using it. No CI secrets, no GitHub Actions publish.
- **Verify after publish:** `npx headless-seo-check@latest --version` and one run against a real site.

> Rules: build locally, never push before the end of the task.
