# Personal OS

A personal life-management web app: todos, projects, friends, trips, vehicles, investments, inventory, media, places, best practices. Single-user, cloud-synced, installable as a PWA on iPhone.

Live: <https://personal-os-two-gold.vercel.app> (gated — internal use only).

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4** with OKLCH tokens, light + dark
- **Prisma 6** + **Neon Postgres** (single source of truth)
- **Vercel** hosting + cron + edge middleware
- **Anthropic Claude API** for capture, summarization, and project chat
- **PWA**: installable, offline service worker, iOS home-screen icon

## Layout

```
src/
  app/                 Next.js routes (pages + API)
    api/               REST endpoints
    login/             password gate
    projects/[id]/     project detail with Tasks/Notes/Files tabs
    trips/[id]/        trip itinerary (flights, lodging, tasks, ...)
    friends/           personal CRM
    vehicles/          vehicle records
    investments/       portfolio
    inventory/         possessions
    ...
  components/          shared React components
  lib/                 prisma client, utils, services
  middleware.ts        cookie-gated auth on all routes

prisma/
  schema.prisma        canonical schema (Neon-only)

quick-todo/            macOS menu-bar capture app (Swift)
                       — global ⌃Space hotkey, POSTs to /api/capture/todo

tasks/
  lessons.md           lessons from past mistakes
```

## Develop

```sh
pnpm install
pnpm dev               # http://localhost:3000
```

Required env (`.env.local`):

- `DATABASE_URL` — Neon pooled connection
- `ANTHROPIC_API_KEY` — Claude API
- `CAPTURE_TOKEN` — bearer for `/api/capture/todo` (used by Quick Todo)
- `APP_PASSWORD` — single password for the login gate (default `456` if unset)

## Deploy

```sh
pnpm exec next build   # type-check + build
pnpm exec vercel --prod --yes
```

## Quick Todo

The menu-bar Mac app under `quick-todo/` registers a global hotkey (default ⌃Space), pops a HUD input, and POSTs to `/api/capture/todo`. See `quick-todo/README.md`.

## Status

Active solo development. Auth + Neon-only data + most features shipped. Mobile redesign toward iOS Reminders feel in progress.
