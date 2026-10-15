# DeviceOps dashboard UI

DeviceOps remains the application base. Its six Operations views and existing
specialist routes use a shared dashboard shell with a collapsible sidebar,
accessible mobile drawer, breadcrumbs, semantic cards, tables, and forms.
The UI continues to use DeviceOps authentication, tenant identity, API handlers,
polling, operational notifications, proposal hashes, and approval controls.

## Reference and cleanup

UI components and palette tokens were adapted from
[Kiranism/next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter)
at revision `7705dfc0d13889e45c26a55ad5908da6a7a9a605`.
The reference was left untouched. In a disposable copy, the supported cleanup was
run before selecting the reusable primitives and layout patterns:

```sh
node scripts/cleanup.js clerk sentry kanban chat ai-chat notifications examples
```

The starter's authentication, organizations, billing, Sentry, chat, kanban,
notification demos, examples, product/user demonstrations, mock API, sample
analytics, and promotional navigation were not imported. DeviceOps notifications
and operational scenarios remain available. No starter authentication provider
or server feature was added. The starter's MIT notice is retained in
[`licenses/kiranism-dashboard-MIT.txt`](licenses/kiranism-dashboard-MIT.txt).

The foundation uses Tailwind CSS v4, Base UI, shadcn-style primitives,
class-variance-authority, clsx, and tailwind-merge. The existing DeviceOps Next.js,
React, Lucide, npm workspaces, and API types are retained. The mobile sidebar only
mounts tooltips on collapsed desktop navigation, allowing Escape to dismiss the
drawer and return keyboard focus normally.

## Themes and navigation

Vercel is the default palette. All ten reference palettes are available: Vercel,
Claude, Discord, Supabase, Mono, Notebook, Light Green, Zen, Astro Vista, and
WhatsApp. Palette tokens use `data-palette` and a separate `deviceops-palette`
storage key. `deviceops-theme` remains the Light/Dark/System preference;
`data-theme` remains the resolved mode. System tracks OS changes, and preferences
still work in memory when storage is unavailable. A preload script applies saved
preferences before paint. Status colors use dedicated readable semantic tokens
so palette changes do not change the meaning of operational states.

Operations navigation continues to preserve `view`, `incident`, unrelated query
parameters, and browser history. `/diagnosis`, `/runs/[id]`, `/approvals`,
`/incidents`, and `/evaluations` retain their original actions and URLs. The
dashboard shows actual authenticated user and tenant information. Overview
metrics, topology, anomalies, and recovery details continue to use DeviceOps
state; no starter analytics or placeholder chart series were introduced.

## Local verification

Use Node.js 22.16.0 and the root npm lockfile. Existing project environment and
local services are configured as before; no migration is needed for the UI.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run contracts:check
npm run build --workspace @deviceops/web
npm run start --workspace @deviceops/web -- --port 3041
```

In a second terminal:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3041 npm run test:web:e2e -- tests/web/operations.spec.ts tests/web/ui-redesign.spec.ts --workers=1
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a locally installed Chromium/Chrome path
if Playwright's browser is not installed. Browser tests use explicit API fixtures
and assert UI behavior, v1/v2 action payloads, authorization presentation, session
and refresh errors, deep links/history, themes, keyboard navigation, and layout
at desktop, tablet, and 390px widths. They do not establish backend, live-device,
database, or provider correctness. The live Operations check needs a disposable
seeded stack and `OPS_TEST_PASSWORD`. Screenshots go to Playwright's test results,
without overwriting the existing repository screenshots.

The redesign was developed in a separate implementation checkout. Both original
DeviceOps checkouts and the reference starter were preserved. The October 2–3
verification was local; no deployment, database migration, or backend/provider
change was performed. The UI changes were prepared for GitHub publication on
October 15 at the project owner’s request.

## Usability refinement (October 3, 2026)

The overview now recommends a next step from existing incidents and pending proposals. Equipment, approvals, and troubleshooting guides have direct shortcuts. Incident and recovery panels are separate, and mode/budget details are expandable. Metrics stay on Overview to keep other pages focused.

Native selects preserve their keyboard and change-event contracts while sharing palette surfaces, chevrons, focus rings, and light/dark color schemes. Cards, icons, hover/selected states, forms, and accordions use semantic palette variables and theme radii. Section descriptions and incident guidance use clearer language. Mobile card content wraps and grows to fit. New browser checks cover the guided path, keyboard disclosures, themed filters/hover, and clipped card content.
