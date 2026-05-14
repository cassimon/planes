/**
 * Module-level Keycloak singleton.
 *
 * Stores the Keycloak instance in memory after a successful NOMAD OAuth login
 * so the rest of the app (OpenAPI client, HttpBackend, auth guards) can read
 * the current access token without ever touching localStorage.
 *
 * Local (email/password) login still stores its token in localStorage under
 * "access_token"; the sync/async getters here fall back to that value so both
 * auth paths work transparently.
 */

import Keycloak from "keycloak-js"

let _keycloak: Keycloak | null = null
let _refreshInterval: ReturnType<typeof setInterval> | null = null

/** Store the initialised Keycloak instance and start the refresh watchdog. */
export function setKeycloak(kc: Keycloak): void {
  _keycloak = kc

  // Mirror the setInterval from the reference initAuth snippet:
  // attempt a silent refresh every 10 s; if it fails the session has expired.
  if (_refreshInterval !== null) clearInterval(_refreshInterval)
  _refreshInterval = setInterval(() => {
    if (_keycloak?.authenticated) {
      _keycloak.updateToken(30).catch(() => {
        clearKeycloak()
        window.location.href = "/login"
      })
    }
  }, 10_000)
}

/** Clear the instance and stop the refresh watchdog (called on logout / error). */
export function clearKeycloak(): void {
  if (_refreshInterval !== null) {
    clearInterval(_refreshInterval)
    _refreshInterval = null
  }
  _keycloak = null
}

/**
 * Synchronous token read — safe to call from non-async contexts.
 * Returns the cached Keycloak token when an OAuth session is active,
 * otherwise falls back to the localStorage token (local login).
 */
export function getTokenSync(): string | null {
  if (_keycloak?.authenticated && _keycloak.token) return _keycloak.token
  return localStorage.getItem("access_token")
}

/**
 * Async token read — calls updateToken() first so the caller always gets a
 * fresh token.  Used by the OpenAPI client interceptor.
 */
export async function getTokenAsync(): Promise<string> {
  if (_keycloak?.authenticated) {
    try {
      await _keycloak.updateToken(30)
    } catch {
      clearKeycloak()
      window.location.href = "/login"
      return ""
    }
    return _keycloak.token ?? ""
  }
  return localStorage.getItem("access_token") ?? ""
}

/** Returns true when either auth method has an active session. */
export function isAuthenticated(): boolean {
  if (_keycloak?.authenticated) return true
  return localStorage.getItem("access_token") !== null
}

/**
 * Unified logout.
 * - Keycloak users: clears the instance and redirects through Keycloak's
 *   logout endpoint (which invalidates the server-side session).
 * - Local users: clears localStorage only.
 *
 * Returns true when a Keycloak redirect was initiated so the caller can skip
 * its own navigation.
 */
export function logout(): boolean {
  localStorage.removeItem("access_token")
  if (_keycloak?.authenticated) {
    const kc = _keycloak
    clearKeycloak()
    kc.logout({ redirectUri: window.location.origin + "/login" })
    return true
  }
  clearKeycloak()
  return false
}
