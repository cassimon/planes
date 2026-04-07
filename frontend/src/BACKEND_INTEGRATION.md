# Backend Integration Plan — Plains GUI ↔ Plains FastAPI

Connect `plains_gui` (this React/Mantine app) to the [plains](https://github.com/cassimon/plains) FastAPI backend (fork of `full-stack-fastapi-template`).

---

## 1. Backend: Define SQLModel Models

In `backend/app/models.py`, add models mirroring the frontend types in `src/store/AppContext.tsx`:

| Frontend type | SQLModel table | Key fields |
|---|---|---|
| `Material` | `Material` | id (UUID PK), type, name, supplier, cas_number, purity, … |
| `Solution` | `Solution` + `SolutionComponent` | id, name; FK to Material for components |
| `Experiment` | `Experiment` + `ExperimentLayer` + `Substrate` | id, name, date, architecture, layers (JSON or relation), substrates |
| `ExperimentResults` | `ExperimentResults` + `MeasurementFile` + `DeviceGroup` | id, experiment_id (FK), files, device_groups |
| `Plane` | `Plane` + `CanvasElement` | id, name; elements stored as JSON column or polymorphic relation |

All tables get `owner_id: UUID` (FK → `User`) for per-user data isolation, following the existing `Item` pattern.

## 2. Backend: Create API Routes

Add route modules under `backend/app/api/routes/`, one per entity:

- `materials.py` — CRUD `/api/v1/materials`
- `solutions.py` — CRUD `/api/v1/solutions`
- `experiments.py` — CRUD `/api/v1/experiments`
- `results.py` — CRUD `/api/v1/results`
- `planes.py` — CRUD `/api/v1/planes` + nested `/api/v1/planes/{id}/elements`
- `state.py` — `GET /api/v1/state` (full snapshot) + `PUT /api/v1/state` (bulk save)

Copy the `items.py` route pattern: inject `SessionDep` and `CurrentUser`, enforce ownership checks, return Pydantic response models.

Register all routers in `backend/app/api/main.py`.

## 3. Backend: Run Migrations

```bash
cd backend
alembic revision --autogenerate -m "Add plains domain models"
alembic upgrade head
```

## 4. Frontend: Configure Auth

The plains backend uses JWT (access + refresh tokens via `/api/v1/login/access-token`).

In the frontend, use the existing `createTokenManager` from `src/store/backend.ts`:

```ts
const auth = createTokenManager({
  storageKey: 'plains_auth',
  onRefresh: async (refreshToken) => {
    const res = await fetch('/api/v1/login/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return res.json();
  },
});
```

Add a login page/modal that calls `POST /api/v1/login/access-token` with email + password and passes the result to `auth.setTokens(...)`.

## 5. Frontend: Wire Up HttpBackend

In `src/main.tsx` (or wherever `<AppProvider>` is rendered):

```tsx
import { HttpBackend, createTokenManager } from './store/backend';

const auth = createTokenManager({ /* ... */ });
const backend = new HttpBackend('/api/v1', auth);

<AppProvider backend={backend}>
  <App />
</AppProvider>
```

This swaps localStorage persistence for real API calls — no page component changes needed.

## 6. Frontend: Proxy API in Dev

In `vite.config.mjs`, add a proxy so `/api` requests reach the FastAPI backend:

```ts
server: {
  proxy: {
    '/api': 'http://localhost:8000',
  },
}
```

## 7. Deployment

The plains template already provides Docker Compose for backend + PostgreSQL + Traefik.

- **Option A (monorepo):** Move `plains_gui` into the `frontend/` directory of the plains repo, replacing the default React + Tailwind frontend.
- **Option B (separate repos):** Build `plains_gui` with `vite build`, serve the `dist/` folder via Traefik or a simple Nginx container alongside the backend.

Update `.env` with `FRONTEND_HOST` and CORS settings.

## Summary Checklist

- [ ] Add SQLModel tables in `backend/app/models.py`
- [ ] Add CRUD utils in `backend/app/crud.py`
- [ ] Add API routes in `backend/app/api/routes/`
- [ ] Register routes in `backend/app/api/main.py`
- [ ] Run Alembic migration
- [ ] Add login page in frontend
- [ ] Instantiate `HttpBackend` + `createTokenManager` in frontend
- [ ] Add Vite dev proxy
- [ ] Configure Docker Compose / deployment
