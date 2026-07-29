# Contributing to Flux

Thanks for helping improve Flux. This project is a self-hosted media platform with a web app, Fastify backend, and Android wrapper.

## Development Setup

1. Install Node.js 22 or newer.
2. Install Docker and Docker Compose.
3. Copy `.env.example` to `.env` and fill in local values.
4. Install dependencies:

```bash
npm ci
```

5. Start the stack:

```bash
docker compose up --build
```

## Useful Commands

```bash
npm run typecheck
npm run lint
npm test --workspace @flux/backend
npm run build
```

## Pull Requests

- Keep changes focused and explain the user-visible behavior in the PR summary.
- Include tests for behavior changes when practical.
- Update docs when setup, deployment, API behavior, or client behavior changes.
- Do not commit `.env`, private keys, release keystores, APK build outputs, local logs, downloaded media, or secrets.
- For Prisma changes, commit the migration and mention whether it was tested with `prisma migrate deploy`.

## Project Areas

- `packages/frontend`: Next.js app and player UI.
- `packages/backend`: Fastify API, Prisma schema, auth, torrents, library, streaming, and device APIs.
- `shared`: shared TypeScript contracts.
- `android`: Android WebView shell and native bridge.
- `docs`: operational and client-specific documentation.

## Responsible Use

Flux is intended for self-hosted media libraries and legitimate content workflows. Do not use issues, discussions, PRs, or examples to request help finding, downloading, sharing, or distributing copyrighted content without permission.
