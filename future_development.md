# Plains — Development & Deployment Guide

## Prerequisites

| Tool | Purpose |
|------|---------|
| Docker + Docker Compose | Run all services locally |
| [uv](https://docs.astral.sh/uv/) | Python env & deps (`backend/`) |
| [Bun](https://bun.sh/) (or Node) | Frontend tooling (`frontend/`) |

Start the full stack: `docker compose watch`

| URL | Service |
|-----|---------|
| http://localhost:5173 | Frontend (nginx) |
| http://localhost:8000 | Backend API |
| http://localhost:8000/docs | Swagger UI |
| http://localhost:8080 | Adminer (DB admin) |
| http://localhost:1080 | Mailcatcher |

---

## A) Pure Frontend Modifications

For UI-only changes (components, pages, styles) — no Docker rebuild needed.

```bash
# 1. Stop the Docker frontend so ports don't clash
docker compose stop frontend

# 2. Run Vite dev server with hot reload
cd frontend
bun install
bun run dev
# → http://localhost:5173, API calls go to http://localhost:8000 (via VITE_API_URL in .env)

# 3. Edit files under frontend/src/ — changes appear instantly
```

**Checklist:**
- [ ] `bun run lint` passes (biome)
- [ ] `npx tsc -p tsconfig.build.json --noEmit` — no type errors
- [ ] Rebuild Docker image before testing in production-like mode:
      `docker compose build frontend && docker compose up -d frontend`

---

## B) Backend Modifications

### Code changes (models, routes, CRUD)

The backend container runs `fastapi run --reload` and syncs code via `docker compose watch`, so code changes apply automatically.

```bash
# Edit files under backend/app/
# The running container picks up changes via watch sync + --reload
# Check logs:
docker compose logs -f backend
```

### Database migrations (model changes)

```bash
# 1. Generate migration INSIDE the container
docker compose exec backend bash
cd /app/backend
alembic revision --autogenerate -m "Describe the change"
exit

# 2. Copy migration file to host (watch sync is one-way: host→container)
docker compose cp backend:/app/backend/app/alembic/versions/ backend/app/alembic/versions/

# 3. Apply migration
docker compose exec backend bash -c "cd /app/backend && alembic upgrade head"

# 4. Commit the new migration file to git
```

> **Important:** Migration files must live on the host and be committed.
> The `prestart` service runs `alembic upgrade head` on every `docker compose up`,
> so any user pulling the repo gets all tables created automatically.

### Adding dependencies

```bash
cd backend
uv add <package>
# Then rebuild the backend image:
docker compose build backend && docker compose up -d backend
```

**Checklist:**
- [ ] `alembic upgrade head` succeeds
- [ ] Migration file committed to `backend/app/alembic/versions/`
- [ ] `docker compose exec backend bash scripts/tests-start.sh` passes

---

## C) Full-Stack Modifications (Backend + Frontend)

When backend API changes affect the frontend (new endpoints, changed schemas):

```bash
# 1. Make backend changes (models, routes) and apply migrations (see §B)

# 2. Regenerate the frontend API client
bash scripts/generate-client.sh
# This: starts backend → downloads openapi.json → generates client → runs biome lint

# 3. Update frontend code to use new/changed client functions

# 4. Test end-to-end
docker compose build frontend && docker compose up -d frontend
# Open http://localhost:5173 and verify
```

**Checklist:**
- [ ] `scripts/generate-client.sh` exits cleanly
- [ ] Updated files in `frontend/src/client/` committed
- [ ] Manual smoke test in browser

---

## D) Testing & Linting

### Backend

```bash
# Run full test suite inside the container
docker compose exec backend bash scripts/tests-start.sh

# Run with options (e.g., stop on first failure)
docker compose exec backend bash scripts/tests-start.sh -x

# Coverage report → backend/htmlcov/index.html
```

### Frontend — linting

```bash
cd frontend
bun run lint          # biome check
bun run type-check    # tsc --noEmit (if configured), or:
npx tsc -p tsconfig.build.json --noEmit
```

### Frontend — E2E tests (Playwright)

```bash
# Ensure stack is running
docker compose up -d --wait backend

# Run Playwright tests
cd frontend
bunx playwright test

# Interactive UI mode
bunx playwright test --ui
```

### Pre-commit checklist

- [ ] `docker compose exec backend bash scripts/tests-start.sh` — all pass
- [ ] `bash scripts/generate-client.sh` — exits 0
- [ ] `cd frontend && bun run lint` — no errors
- [ ] `npx tsc -p tsconfig.build.json --noEmit` — no errors
- [ ] `bunx playwright test` — all pass

---

## E) Deployment

### Build production images

```bash
# Build without dev overrides
docker compose -f compose.yml build
```

### Deploy to a server

```bash
# 1. Copy code to server
rsync -av --filter=":- .gitignore" ./ root@your-server:/root/code/app/

# 2. Set environment variables on server (see .env, especially):
#    DOMAIN, ENVIRONMENT=production, SECRET_KEY, POSTGRES_PASSWORD,
#    FIRST_SUPERUSER_PASSWORD, FRONTEND_HOST, BACKEND_CORS_ORIGINS, SMTP_*

# 3. Set up Traefik (one-time, handles HTTPS/TLS):
rsync -a compose.traefik.yml root@your-server:/root/code/traefik-public/
ssh root@your-server "docker network create traefik-public"
ssh root@your-server "cd /root/code/traefik-public && docker compose -f compose.traefik.yml up -d"

# 4. Deploy the app (prestart auto-runs migrations)
ssh root@your-server "cd /root/code/app && docker compose -f compose.yml up -d"
```

### CI/CD (GitHub Actions)

Pre-configured workflows deploy automatically:
- **staging** → on push/merge to `master`
- **production** → on GitHub release publish

Required GitHub secrets: `DOMAIN_PRODUCTION`, `DOMAIN_STAGING`, `STACK_NAME_PRODUCTION`,
`STACK_NAME_STAGING`, `SECRET_KEY`, `POSTGRES_PASSWORD`, `FIRST_SUPERUSER`,
`FIRST_SUPERUSER_PASSWORD`, `EMAILS_FROM_EMAIL`

---

## F) Security — Pre-Deployment Checklist

**Every item below must be addressed before exposing the application to the internet.**

### Secrets & credentials

- [ ] `SECRET_KEY` — generate a unique value: `python -c "import secrets; print(secrets.token_urlsafe(32))"`
- [ ] `POSTGRES_PASSWORD` — change from `changethis`
- [ ] `FIRST_SUPERUSER_PASSWORD` — change from `changethis`
- [ ] `FIRST_SUPERUSER` — set to a real email address (not `admin@example.com`)
- [ ] No secrets committed to git (check `.env` is in `.gitignore`)

### Network & TLS

- [ ] Traefik configured with Let's Encrypt for HTTPS
- [ ] `DOMAIN` set to your real domain
- [ ] `FRONTEND_HOST` set to `https://dashboard.yourdomain.com`
- [ ] `BACKEND_CORS_ORIGINS` restricted to your actual frontend domain(s) only
- [ ] `ENVIRONMENT` set to `production` (disables debug features)
- [ ] Adminer either removed from compose or not exposed publicly
- [ ] Mailcatcher removed from production compose
- [ ] Traefik dashboard protected with HTTP Basic Auth or disabled

### Database

- [ ] PostgreSQL not exposed on public ports (remove `ports: "5432:5432"` — present only in override)
- [ ] Database backups configured
- [ ] All migrations committed and `alembic upgrade head` runs cleanly on fresh DB

### Application

- [ ] SMTP configured for real email delivery (password reset, verification)
- [ ] Sentry DSN configured for error monitoring (optional but recommended)
- [ ] Review rate limiting on auth endpoints (login, password reset)
- [ ] `compose.override.yml` is NOT used in production (use `docker compose -f compose.yml` explicitly)

### Container security

- [ ] Docker images use pinned base versions
- [ ] No `--reload` flag in production (the default `CMD` in Dockerfile is correct)
- [ ] Backend runs with `--workers 4` (default in Dockerfile, not in override)
