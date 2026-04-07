/**
 * Backend adapter interface for Plains GUI.
 *
 * Every data mutation in AppContext is routed through a BackendAdapter.
 * The default `InMemoryBackend` keeps everything in-memory (current behaviour).
 * To connect to a real database, implement `HttpBackend` (or similar) and pass
 * it to `<AppProvider backend={myBackend}>`.
 *
 * Design principles:
 *   - The adapter is the single source of truth for persisted state.
 *   - All methods return Promises so that HTTP adapters work naturally.
 *   - The adapter never touches React state directly — AppProvider does that
 *     after the adapter call resolves.
 *   - Auth tokens are managed by `AuthTokenManager` and injected into the
 *     HTTP adapter at construction time.
 */

import type {
  CanvasElement,
  Experiment,
  ExperimentResults,
  Material,
  Plane,
  Solution,
} from "./AppContext"

// ── Auth ──────────────────────────────────────────────────────────────────────

export type AuthTokens = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number // Unix ms
}

export type AuthTokenManager = {
  /** Get the current access token, refreshing if expired. */
  getAccessToken(): Promise<string>
  /** Store new tokens (e.g. after login or refresh). */
  setTokens(tokens: AuthTokens): void
  /** Clear tokens (logout). */
  clearTokens(): void
  /** Register a listener for auth state changes. Returns unsubscribe fn. */
  onAuthChange(listener: (authenticated: boolean) => void): () => void
}

/**
 * A simple token manager that stores tokens in memory with optional
 * localStorage persistence.  Replace with your OAuth / SSO flow as needed.
 */
export function createTokenManager(options?: {
  storageKey?: string
  onRefresh?: (refreshToken: string) => Promise<AuthTokens>
}): AuthTokenManager {
  const storageKey = options?.storageKey ?? "plains_auth"
  const listeners = new Set<(authenticated: boolean) => void>()

  let tokens: AuthTokens | null = loadFromStorage()

  function loadFromStorage(): AuthTokens | null {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? (JSON.parse(raw) as AuthTokens) : null
    } catch {
      return null
    }
  }

  function persist() {
    try {
      if (tokens) {
        localStorage.setItem(storageKey, JSON.stringify(tokens))
      } else {
        localStorage.removeItem(storageKey)
      }
    } catch {
      // Storage unavailable (SSR, private mode) — graceful no-op
    }
  }

  function notify() {
    const authed = tokens !== null
    for (const fn of listeners) {
      fn(authed)
    }
  }

  return {
    async getAccessToken(): Promise<string> {
      if (!tokens) {
        throw new Error("Not authenticated")
      }

      // Refresh if expired (with 30 s buffer)
      if (tokens.expiresAt && Date.now() > tokens.expiresAt - 30_000) {
        if (options?.onRefresh && tokens.refreshToken) {
          tokens = await options.onRefresh(tokens.refreshToken)
          persist()
        } else {
          throw new Error("Token expired and no refresh handler configured")
        }
      }

      return tokens.accessToken
    },

    setTokens(t: AuthTokens) {
      tokens = t
      persist()
      notify()
    },

    clearTokens() {
      tokens = null
      persist()
      notify()
    },

    onAuthChange(listener: (authenticated: boolean) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// ── Backend adapter interface ────────────────────────────────────────────────

/** Full application state snapshot used for initial load and persistence. */
export type AppSnapshot = {
  materials: Material[]
  solutions: Solution[]
  experiments: Experiment[]
  results: ExperimentResults[]
  planes: Plane[]
}

/**
 * Backend adapter — the contract that any persistence layer must fulfil.
 *
 * All mutating methods return the authoritative entity so that the UI can
 * reconcile optimistic updates.  Read-only methods return arrays or snapshots.
 */
export interface BackendAdapter {
  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Load the full application state (called once on mount). */
  load(): Promise<AppSnapshot>

  /** Persist the full application state (called on unmount / periodic save). */
  save(snapshot: AppSnapshot): Promise<void>

  // ── Materials ──────────────────────────────────────────────────────────────

  getMaterials(): Promise<Material[]>
  createMaterial(material: Material): Promise<Material>
  updateMaterial(material: Material): Promise<Material>
  deleteMaterial(id: string): Promise<void>

  // ── Solutions ──────────────────────────────────────────────────────────────

  getSolutions(): Promise<Solution[]>
  createSolution(solution: Solution): Promise<Solution>
  updateSolution(solution: Solution): Promise<Solution>
  deleteSolution(id: string): Promise<void>

  // ── Experiments ────────────────────────────────────────────────────────────

  getExperiments(): Promise<Experiment[]>
  createExperiment(experiment: Experiment): Promise<Experiment>
  updateExperiment(experiment: Experiment): Promise<Experiment>
  deleteExperiment(id: string): Promise<void>

  // ── Results ────────────────────────────────────────────────────────────────

  getResults(): Promise<ExperimentResults[]>
  createResults(results: ExperimentResults): Promise<ExperimentResults>
  updateResults(results: ExperimentResults): Promise<ExperimentResults>
  deleteResults(id: string): Promise<void>

  // ── Planes & Elements ──────────────────────────────────────────────────────

  getPlanes(): Promise<Plane[]>
  createPlane(plane: Plane): Promise<Plane>
  updatePlane(plane: Plane): Promise<Plane>
  deletePlane(id: string): Promise<void>

  createElement(planeId: string, element: CanvasElement): Promise<CanvasElement>
  updateElement(planeId: string, element: CanvasElement): Promise<CanvasElement>
  deleteElement(planeId: string, elementId: string): Promise<void>
}

// ── In-memory (default) adapter ──────────────────────────────────────────────

const LOCAL_STORAGE_KEY = "plains_app_state"

/**
 * Default backend that keeps state in memory with optional localStorage
 * persistence for page reloads.
 */
export class InMemoryBackend implements BackendAdapter {
  private data: AppSnapshot

  constructor(initial?: Partial<AppSnapshot>) {
    this.data = {
      materials: initial?.materials ?? [],
      solutions: initial?.solutions ?? [],
      experiments: initial?.experiments ?? [],
      results: initial?.results ?? [],
      planes: initial?.planes ?? [],
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async load(): Promise<AppSnapshot> {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppSnapshot>
        this.data = {
          materials: parsed.materials ?? this.data.materials,
          solutions: parsed.solutions ?? this.data.solutions,
          experiments: parsed.experiments ?? this.data.experiments,
          results: parsed.results ?? this.data.results,
          planes: parsed.planes ?? this.data.planes,
        }
      }
    } catch {
      // Corrupted storage — start fresh
    }
    return { ...this.data }
  }

  async save(snapshot: AppSnapshot): Promise<void> {
    this.data = snapshot
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snapshot))
    } catch {
      // Storage full or unavailable
    }
  }

  // ── Materials ──────────────────────────────────────────────────────────────

  async getMaterials() {
    return [...this.data.materials]
  }
  async createMaterial(m: Material) {
    this.data.materials = [...this.data.materials, m]
    return m
  }
  async updateMaterial(m: Material) {
    this.data.materials = this.data.materials.map((x) =>
      x.id === m.id ? m : x,
    )
    return m
  }
  async deleteMaterial(id: string) {
    this.data.materials = this.data.materials.filter((x) => x.id !== id)
  }

  // ── Solutions ──────────────────────────────────────────────────────────────

  async getSolutions() {
    return [...this.data.solutions]
  }
  async createSolution(s: Solution) {
    this.data.solutions = [...this.data.solutions, s]
    return s
  }
  async updateSolution(s: Solution) {
    this.data.solutions = this.data.solutions.map((x) =>
      x.id === s.id ? s : x,
    )
    return s
  }
  async deleteSolution(id: string) {
    this.data.solutions = this.data.solutions.filter((x) => x.id !== id)
  }

  // ── Experiments ────────────────────────────────────────────────────────────

  async getExperiments() {
    return [...this.data.experiments]
  }
  async createExperiment(e: Experiment) {
    this.data.experiments = [...this.data.experiments, e]
    return e
  }
  async updateExperiment(e: Experiment) {
    this.data.experiments = this.data.experiments.map((x) =>
      x.id === e.id ? e : x,
    )
    return e
  }
  async deleteExperiment(id: string) {
    this.data.experiments = this.data.experiments.filter((x) => x.id !== id)
  }

  // ── Results ────────────────────────────────────────────────────────────────

  async getResults() {
    return [...this.data.results]
  }
  async createResults(r: ExperimentResults) {
    this.data.results = [...this.data.results, r]
    return r
  }
  async updateResults(r: ExperimentResults) {
    this.data.results = this.data.results.map((x) => (x.id === r.id ? r : x))
    return r
  }
  async deleteResults(id: string) {
    this.data.results = this.data.results.filter((x) => x.id !== id)
  }

  // ── Planes & Elements ──────────────────────────────────────────────────────

  async getPlanes() {
    return [...this.data.planes]
  }
  async createPlane(p: Plane) {
    this.data.planes = [...this.data.planes, p]
    return p
  }
  async updatePlane(p: Plane) {
    this.data.planes = this.data.planes.map((x) => (x.id === p.id ? p : x))
    return p
  }
  async deletePlane(id: string) {
    this.data.planes = this.data.planes.filter((x) => x.id !== id)
  }

  async createElement(planeId: string, element: CanvasElement) {
    this.data.planes = this.data.planes.map((p) =>
      p.id === planeId ? { ...p, elements: [...p.elements, element] } : p,
    )
    return element
  }
  async updateElement(planeId: string, element: CanvasElement) {
    this.data.planes = this.data.planes.map((p) =>
      p.id === planeId
        ? {
            ...p,
            elements: p.elements.map((e) =>
              e.id === element.id ? element : e,
            ),
          }
        : p,
    )
    return element
  }
  async deleteElement(planeId: string, elementId: string) {
    this.data.planes = this.data.planes.map((p) =>
      p.id === planeId
        ? { ...p, elements: p.elements.filter((e) => e.id !== elementId) }
        : p,
    )
  }
}

// ── HTTP adapter ─────────────────────────────────────────────────────────────

const EMPTY_SNAPSHOT: AppSnapshot = {
  materials: [],
  solutions: [],
  experiments: [],
  results: [],
  planes: [],
}

/**
 * HTTP adapter that persists the full AppSnapshot as a JSON blob via
 * `GET/PUT /api/v1/state`.  The JWT access token is read from localStorage
 * (`access_token` key), matching the template's auth flow.
 *
 * Only `load()` and `save()` hit the network.  Per-entity methods delegate to
 * the in-memory copy so that the AppProvider's periodic save flushes everything
 * in one request.
 */
export class HttpBackend implements BackendAdapter {
  private data: AppSnapshot = { ...EMPTY_SNAPSHOT }

  constructor(private baseUrl: string = "/api/v1") {}

  private getToken(): string {
    const token = localStorage.getItem("access_token")
    if (!token) throw new Error("Not authenticated")
    return token
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async load(): Promise<AppSnapshot> {
    const res = await fetch(`${this.baseUrl}/state/`, {
      headers: { Authorization: `Bearer ${this.getToken()}` },
    })
    if (!res.ok) {
      console.warn(`[HttpBackend] load failed (${res.status}), starting fresh`)
      return { ...EMPTY_SNAPSHOT }
    }
    const json = await res.json()
    // The API returns { data: {...}, updated_at: ... }
    const raw = json.data ?? {}
    this.data = {
      materials: raw.materials ?? [],
      solutions: raw.solutions ?? [],
      experiments: raw.experiments ?? [],
      results: raw.results ?? [],
      planes: raw.planes ?? [],
    }
    return { ...this.data }
  }

  async save(snapshot: AppSnapshot): Promise<void> {
    this.data = snapshot
    try {
      await fetch(`${this.baseUrl}/state/`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.getToken()}`,
        },
        body: JSON.stringify({ data: snapshot }),
      })
    } catch (err) {
      console.warn(
        "[HttpBackend] save failed, will retry on next interval",
        err,
      )
    }
  }

  // ── Per-entity methods (delegate to in-memory copy) ────────────────────────

  async getMaterials() {
    return [...this.data.materials]
  }
  async createMaterial(m: Material) {
    this.data.materials = [...this.data.materials, m]
    return m
  }
  async updateMaterial(m: Material) {
    this.data.materials = this.data.materials.map((x) =>
      x.id === m.id ? m : x,
    )
    return m
  }
  async deleteMaterial(id: string) {
    this.data.materials = this.data.materials.filter((x) => x.id !== id)
  }

  async getSolutions() {
    return [...this.data.solutions]
  }
  async createSolution(s: Solution) {
    this.data.solutions = [...this.data.solutions, s]
    return s
  }
  async updateSolution(s: Solution) {
    this.data.solutions = this.data.solutions.map((x) =>
      x.id === s.id ? s : x,
    )
    return s
  }
  async deleteSolution(id: string) {
    this.data.solutions = this.data.solutions.filter((x) => x.id !== id)
  }

  async getExperiments() {
    return [...this.data.experiments]
  }
  async createExperiment(e: Experiment) {
    this.data.experiments = [...this.data.experiments, e]
    return e
  }
  async updateExperiment(e: Experiment) {
    this.data.experiments = this.data.experiments.map((x) =>
      x.id === e.id ? e : x,
    )
    return e
  }
  async deleteExperiment(id: string) {
    this.data.experiments = this.data.experiments.filter((x) => x.id !== id)
  }

  async getResults() {
    return [...this.data.results]
  }
  async createResults(r: ExperimentResults) {
    this.data.results = [...this.data.results, r]
    return r
  }
  async updateResults(r: ExperimentResults) {
    this.data.results = this.data.results.map((x) => (x.id === r.id ? r : x))
    return r
  }
  async deleteResults(id: string) {
    this.data.results = this.data.results.filter((x) => x.id !== id)
  }

  async getPlanes() {
    return [...this.data.planes]
  }
  async createPlane(p: Plane) {
    this.data.planes = [...this.data.planes, p]
    return p
  }
  async updatePlane(p: Plane) {
    this.data.planes = this.data.planes.map((x) => (x.id === p.id ? p : x))
    return p
  }
  async deletePlane(id: string) {
    this.data.planes = this.data.planes.filter((x) => x.id !== id)
  }

  async createElement(planeId: string, element: CanvasElement) {
    this.data.planes = this.data.planes.map((p) =>
      p.id === planeId ? { ...p, elements: [...p.elements, element] } : p,
    )
    return element
  }
  async updateElement(planeId: string, element: CanvasElement) {
    this.data.planes = this.data.planes.map((p) =>
      p.id === planeId
        ? {
            ...p,
            elements: p.elements.map((e) =>
              e.id === element.id ? element : e,
            ),
          }
        : p,
    )
    return element
  }
  async deleteElement(planeId: string, elementId: string) {
    this.data.planes = this.data.planes.map((p) =>
      p.id === planeId
        ? { ...p, elements: p.elements.filter((e) => e.id !== elementId) }
        : p,
    )
  }
}
