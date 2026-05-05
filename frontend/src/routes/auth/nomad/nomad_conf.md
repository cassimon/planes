How to configure Your Oasis

This document explains the minimal configuration required to enable "Login with NOMAD" (central Keycloak realm via your Oasis) and how to wire Plains to accept and use NOMAD-issued tokens.

Backend environment (set in your deployment or `.env`):

```bash
# Enable NOMAD OAuth support in Plains
NOMAD_OAUTH_ENABLED=true

# Oasis Keycloak client ID (the Oasis already has a client registered)
NOMAD_OAUTH_CLIENT_ID=<your-oasis-client-id>

# Central Keycloak realm base URL (JWKS + auth endpoints derived from this)
NOMAD_KEYCLOAK_REALM_URL=https://nomad-lab.eu/fairdi/keycloak/auth/realms/fairdi_nomad_prod

# Existing NOMAD API URL (used for upload API fallback)
NOMAD_URL=http://localhost/nomad-oasis/api/v1

# For compatibility: keep global NOMAD credentials for non-OAuth or service uploads
NOMAD_USE_GLOBAL_AUTH=true
```

Frontend build / runtime env (for the Plains web app):

```bash
# Show the "Login with NOMAD" button in the Plains login page
VITE_NOMAD_OAUTH_ENABLED=true
```

Keycloak / Oasis setup (what to change in the Oasis Keycloak client):

1. Open Keycloak admin for the central realm (example):

   https://nomad-lab.eu/fairdi/keycloak/auth/admin/

2. Select the realm (e.g. `fairdi_nomad_prod`) and the client that represents the Oasis.
3. In the client configuration, add these Redirect URIs (adjust domain for local/dev):

```
https://plains.yourdomain.com/auth/nomad/callback
http://localhost:5173/auth/nomad/callback
```

4. Ensure the client allows the `response_type` you plan to use. The simplest flow Plains currently supports is the implicit/token redirection (frontend receives `access_token` in URL fragment). If you prefer authorization code flow, adapt the frontend callback to exchange the code.

How Plains uses the tokens

- The frontend redirects the user to the Oasis authorization endpoint (constructed from `NOMAD_KEYCLOAK_REALM_URL` and `NOMAD_OAUTH_CLIENT_ID`).
- After login, Keycloak returns a signed JWT (access token) to the browser at the configured redirect URI.
- Plains frontend extracts the `access_token` and posts it to `/api/v1/login/nomad/token` for server-side validation.
- Plains verifies the token locally using the realm JWKS endpoint at

  ```${NOMAD_KEYCLOAK_REALM_URL}/protocol/openid-connect/certs```

- On first valid login the backend upserts a `User` record using the Keycloak `sub` claim (`nomad_sub`) and stores `email`/`name` from the token.
- Plains then uses the same bearer token for calls to both Plains API and the Oasis API (uploads, etc.). If a user has `nomad_sub` set, uploads use the user's token; otherwise global credentials are used.

Database migration

After enabling the feature you must run the Alembic migration that adds `nomad_sub` and makes `hashed_password` optional. From the `backend` folder run:

```bash
cd backend
alembic upgrade head
```

Notes on dual authentication

- Plains supports both local (email/password) and NOMAD OAuth simultaneously.
- Local users keep `hashed_password` populated; NOMAD users have `nomad_sub` populated and typically `hashed_password` = NULL.
- Authentication code checks NOMAD token first (when enabled), then falls back to local tokens.

Troubleshooting and tips

- If the frontend callback receives no `access_token`, verify the Oasis client redirect URIs and the chosen response type.
- Use the JWKS URL to inspect the public keys: `${NOMAD_KEYCLOAK_REALM_URL}/protocol/openid-connect/certs`.
- For local testing you can set `VITE_NOMAD_OAUTH_ENABLED=false` and keep using the local signup/login flow.
- To disable open registration in deployment, set `USERS_OPEN_REGISTRATION=false` in the backend env.

Security considerations

- Plains verifies JWT signatures locally using Keycloak's public keys, so no secret-sharing with Keycloak is required.
- Do not store NOMAD access tokens server-side long-term; tokens live in the browser and are presented as Bearer tokens.
- The backend creates minimal user records (email, name, `nomad_sub`) and relies on the token to carry auth claims.

If you want, I can also add a short README or a script to build the frontend with the correct `VITE_*` values for your CI/deploy pipeline.
