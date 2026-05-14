1. User visits /
   └─ ensureAuthenticated() → isAuthenticated() → _keycloak is null → redirect to /login

2. /login mounts
   └─ fetch GET /api/v1/auth/config (unauthenticated)
      └─ returns { keycloak_url, keycloak_realm, keycloak_client_id }
   └─ new Keycloak({ url, realm, clientId })
   └─ keycloak.init({ onLoad: "check-sso" })
      ├─ If existing SSO session found → setKeycloak(kc) → navigate("/")
      └─ Otherwise → store instance, show button

3. User clicks "Login with NOMAD"
   └─ keycloak.login({ redirectUri: window.origin + "/" })
      └─ Browser → NOMAD Keycloak login page (fairdi_nomad_prod realm)

4. User authenticates at Keycloak
   └─ Keycloak redirects browser to / with ?code=… in URL
   └─ / loads → ensureAuthenticated() → _keycloak is null → redirect to /login again
   └─ /login mounts → keycloak.init() exchanges the auth-code silently (PKCE)
      └─ keycloak now authenticated=true, token set
      └─ setKeycloak(kc) → navigate("/")

5. App loaded, token in memory
   └─ OpenAPI.TOKEN = () => getTokenAsync()
      └─ calls keycloak.updateToken(30) before every API request
   └─ Refresh watchdog: every 10s, proactively refreshes if <30s left

6. API request hits backend
   └─ HTTPBearer extracts "Authorization: Bearer <token>"
   └─ verify_nomad_token(token):
      ├─ Fetches NOMAD JWKS endpoint (key cached)
      ├─ Verifies RS256 signature
      ├─ Validates issuer = NOMAD_KEYCLOAK_REALM_URL
      └─ Validates audience (if NOMAD_OAUTH_VERIFY_AUDIENCE=true)
   └─ Looks up User by nomad_sub; auto-creates on first login
   └─ Returns User to the route handler

7. Logout
   └─ keycloak.logout({ redirectUri: origin + "/login" })
      └─ Browser → Keycloak logout endpoint (invalidates server-side session)
      └─ Keycloak redirects back to /login