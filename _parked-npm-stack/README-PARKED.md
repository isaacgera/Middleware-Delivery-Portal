# Parked: npm-based stack (Fastify + Prisma + React/Vite)

This folder holds the original **npm-dependent** Stage 0 scaffold for MDP
(Fastify API, Prisma ORM, React + Vite frontend, shared TS package).

## Why it's parked
BT's network (Zscaler SSL-inspecting proxy) blocks `npm install` package
downloads from the public registry (`registry.npmjs.org`), returning 403 on
tarballs. No internal npm registry (Nexus) was available/configured on the
machine at build time. So this stack can't be installed here right now.

## What replaced it
MDP is being built **dependency-free** (Option B) in the `../app/` folder:
- `node:http` instead of Fastify
- built-in `node:sqlite` instead of Prisma
- vanilla HTML/CSS/JS instead of React/Vite
- `node:crypto` for password hashing instead of bcryptjs

The **spec, data model, roles, and architecture are unchanged** — only the
implementation technology differs. See the root `SPEC-*.md`.

## If BT npm access is ever sorted
This scaffold is the richer target stack. If a Nexus npm registry URL becomes
available (set it in `.npmrc`), or Zscaler allow-lists npm, this can be revived
and the dependency-free prototype migrated onto it, because the data model and
API design match.

## Note
`apps/` and `packages/` may still be at the project root (OneDrive held file
locks during the move). Drop them in here when the lock clears.
