# Plan: Integrate Plains GUI Behind FastAPI Auth

Mount the Mantine-based Plains GUI pages into the existing FastAPI template's TanStack Router, behind its JWT authentication. Replace the template's post-login layout with the GUI's AppLayout (Mantine AppShell with plane/collection selectors). Keep auth/admin/settings pages using shadcn. Later, replace `InMemoryBackend` with `HttpBackend` backed by real API routes + PostgreSQL.

**Decisions**: GUI's AppLayout for domain pages, shadcn for auth/admin/settings. Both UI libraries coexist. Post-login lands on `/organization`. GUI's `Router.tsx` (React Router) is retired in favor of TanStack Router. `InMemoryBackend` stays for Phase 1, replaced in Phase 4.

---

## Phase 1: Frontend — Add Mantine & Mount GUI Pages (no backend changes)

1. **Add Mantine dependencies** — Install `@mantine/core`, `@mantine/hooks`, `@mantine/modals`, `@mantine/tiptap`, `plotly.js`, `react-plotly.js`, and other GUI deps. Add Mantine PostCSS preset. Import Mantine CSS in the app entry point.

2. **Create a GUI layout route** (`_layout/_gui.tsx`) — New TanStack Router layout wrapping children in `MantineProvider` → `AppProvider` → `ModalsProvider` → GUI's `AppLayout`. Nests inside `_layout.tsx` so the auth guard applies automatically. `AppProvider` uses `InMemoryBackend` initially.

3. **Create TanStack Router routes** for each GUI page under `_layout/_gui/`:
   - `organization.tsx` → `OrganizationPage`, `materials.tsx` → `MaterialsPage`, `solutions.tsx` → `SolutionsPage`, `experiments.tsx` → `ExperimentsPage`, `results.tsx` → `ResultsPage`, `analysis.tsx` → `AnalysisPage`, `export.tsx` → `ExportPage`

4. **Adapt AppLayout for TanStack Router** — Replace React Router's `useNavigate`/`useLocation`/`<Outlet />` with TanStack Router equivalents. Add a user menu (settings, admin for superusers, logout) using `useAuth()`.

5. **Update dashboard redirect** — Change `_layout/index.tsx` to redirect to `/organization`.

6. **Retire GUI's React Router files** — `gui/Router.tsx`, `gui/main.tsx`, `gui/App.tsx` are no longer needed. Keep `gui/theme.ts`.

7. **Handle CSS coexistence** — Ensure Mantine and Tailwind don't clash. May need Tailwind's `preflight: false` or CSS layer isolation.

## Phase 2: Bridge Authentication to GUI Context

1. **Connect `useAuth()` to AppContext** — In `_gui.tsx` layout, read current user from `useAuth()` and surface it to GUI components (AppLayout user menu shows name/email, logout works).

2. **Scope localStorage per user** _(optional)_ — Namespace `InMemoryBackend` storage key by user ID so different users on the same browser don't share data.

## Phase 3: Backend — Domain Models & API Routes

1. **Add SQLModel tables** in `backend/app/models.py` — `Material`, `Solution` + `SolutionComponent`, `Experiment` + `ExperimentLayer` + `Substrate`, `ExperimentResults` + `MeasurementFile` + `DeviceGroup`, `Plane` + `CanvasElement`. All with `owner_id` FK → `User`, following the existing `Item` pattern.

2. **Add CRUD utilities** in `backend/app/crud.py` — One set per entity, always filtering by `owner_id`, following `create_item`/`get_items` patterns.

3. **Add API route modules** under `backend/app/api/routes/` — `materials.py`, `solutions.py`, `experiments.py`, `results.py`, `planes.py`, `state.py` (optional bulk endpoint). Each uses `SessionDep` + `CurrentUser`, following `backend/app/api/routes/items.py`.

4. **Register routes** in `backend/app/api/main.py`.

5. **Run Alembic migration** — `alembic revision --autogenerate` + `alembic upgrade head`.

## Phase 4: Frontend — Wire HttpBackend to Real API

1. **Regenerate API client** — Run `scripts/generate-client.sh` to get types/SDK for new endpoints.

2. **Implement `HttpBackend` using generated SDK** — Update `frontend/src/store/backend.ts` to use generated service functions. Auth token is already in `OpenAPI.TOKEN` — no separate token manager needed.

3. **Switch `AppProvider` to `HttpBackend`** — In `_gui.tsx`, pass `HttpBackend` instance. Remove localStorage auto-save.

4. **Handle initial data loading** — Replace `loadFromStorage()` with backend API calls on mount.

---

## Relevant File Changes

### Frontend Files

**Modify:**
- `frontend/package.json` — add Mantine + GUI dependencies
- `frontend/src/components/AppLayout.tsx` — replace React Router with TanStack Router APIs; add user menu
- `frontend/src/routes/_layout/index.tsx` — redirect to `/organization`
- `frontend/src/store/backend.ts` — implement `HttpBackend` with generated SDK (Phase 4)
- `frontend/src/store/AppContext.tsx` — swap `InMemoryBackend` for `HttpBackend` (Phase 4)
- `frontend/src/main.tsx` — add Mantine CSS import
- `frontend/vite.config.ts` — ensure Mantine PostCSS works alongside Tailwind

**Create:**
- `frontend/src/routes/_layout/_gui.tsx` — GUI layout with MantineProvider + AppProvider + AppLayout
- `frontend/src/routes/_layout/_gui/index.tsx` — redirect to `/organization`
- `frontend/src/routes/_layout/_gui/organization.tsx`
- `frontend/src/routes/_layout/_gui/materials.tsx`
- `frontend/src/routes/_layout/_gui/solutions.tsx`
- `frontend/src/routes/_layout/_gui/experiments.tsx`
- `frontend/src/routes/_layout/_gui/results.tsx`
- `frontend/src/routes/_layout/_gui/analysis.tsx`
- `frontend/src/routes/_layout/_gui/export.tsx`

**Retire (can delete or keep as reference):**
- `frontend/src/gui/Router.tsx`
- `frontend/src/gui/main.tsx`
- `frontend/src/gui/App.tsx`

**Keep as-is:**
- `frontend/src/gui/theme.ts`
- `frontend/src/routes/login.tsx`, `signup.tsx`, `recover-password.tsx`, `reset-password.tsx`
- `frontend/src/routes/_layout/admin.tsx`, `settings.tsx`, `items.tsx`
- All `*.page.tsx` files

### Backend Files

**Modify:**
- `backend/app/models.py` — add domain SQLModel tables
- `backend/app/crud.py` — add CRUD functions per entity
- `backend/app/api/main.py` — register new routers

**Create:**
- `backend/app/api/routes/materials.py`
- `backend/app/api/routes/solutions.py`
- `backend/app/api/routes/experiments.py`
- `backend/app/api/routes/results.py`
- `backend/app/api/routes/planes.py`
- `backend/app/api/routes/state.py` (optional bulk endpoint)

---

## Verification Checklist

### Phase 1
- [ ] Frontend dev server starts (`npm run dev`)
- [ ] Can log in with existing credentials
- [ ] GUI pages render at `/organization`, `/materials`, etc. with Mantine styling
- [ ] Auth pages (login, signup) still work with shadcn styling
- [ ] No CSS conflicts between Mantine and Tailwind
- [ ] localStorage persistence still works (add material → refresh → persists)

### Phase 2
- [ ] User info displays in AppLayout user menu
- [ ] Logout works via AppLayout menu

### Phase 3
- [ ] `alembic upgrade head` succeeds
- [ ] `pytest` passes
- [ ] New endpoints accessible via Swagger UI at `/docs`
- [ ] CRUD operations work via curl/Swagger

### Phase 4
- [ ] API client regeneration succeeds
- [ ] CRUD operations persist to PostgreSQL
- [ ] Different users see only their own data
- [ ] Create material → refresh → persists
- [ ] Playwright test suite passes

---

## Further Considerations

1. **CSS isolation** — Mantine and Tailwind may clash on base styles (button resets, etc.). Test early in Phase 1; consider Tailwind's `preflight: false` or CSS layer isolation if conflicts arise.

2. **Bulk vs per-entity API** — A single `GET/PUT /api/v1/state` endpoint that loads/saves the entire AppContext would be the fastest way to get persistence working (Phase 4). Per-entity CRUD (`/materials`, `/solutions`, etc.) is cleaner long-term but more effort. Recommend starting with bulk endpoint, then migrating incrementally to per-entity.

3. **File storage for results** — `ExperimentResults` involves file uploads (JV, IPCE, stability data). This needs a storage strategy (local filesystem, S3, or database BLOBs). Defer this decision to Phase 3 implementation. Consider multipart form-data endpoints for file upload.

4. **Concurrent edits & sync** — Current architecture assumes single-user state. If multi-user editing is needed later, will require real-time sync (WebSocket or polling delta updates). Current phases assume offline-first with server as persistence layer.

5. **Mantine to shadcn migration** — This plan keeps both UI libraries coexistent. Long-term, may want to standardize on one. Mantine migration of auth/admin/settings pages can be phased in incrementally if needed.

---

## Scope

**Included:**
- JWT authentication integration
- GUI page mounting into TanStack Router
- Backend SQLModel tables and CRUD routes
- Frontend-backend wiring via HttpBackend adapter
- Per-user data isolation

**Excluded:**
- Migrating GUI components from Mantine to shadcn
- Storybook integration
- Real-time multi-user collaboration
- File storage implementation details (S3, local FS, etc.)
- Complex query optimization (pagination, filtering, sorting APIs)
- WebSocket/real-time sync
