# Safe NOMAD Upload — Verification Workflow

This document describes a 5-step manual workflow to verify the NOMAD
integration is safe before any real API call is made.

> **Default state:** `.env` ships with `NOMAD_MOCK_MODE=true`.
> With mock mode active, every function that would hit the network logs
> what it *would* have done and returns a fake response.  
> `httpx.Client` is **never instantiated**.

---

## Prerequisites

```bash
# Start the backend container (or use a local venv — either works)
docker compose up -d backend
docker compose exec backend bash      # all commands below run inside here
```

---

## Step 1 — Verify `.env` is safe

```bash
# Print NOMAD-related variables
env | grep NOMAD
```

**Expected output:**

```
NOMAD_URL=https://nomad-lab.eu/prod/v1/test/api/v1
NOMAD_USERNAME=
NOMAD_PASSWORD=
NOMAD_USE_GLOBAL_AUTH=true
NOMAD_MOCK_MODE=true          # ← must be "true"
```

Check:
- `NOMAD_URL` contains `/test/` (not the production URL).
- `NOMAD_MOCK_MODE` is `true`.
- `NOMAD_USERNAME` / `NOMAD_PASSWORD` are empty (no credentials = extra safety).

---

## Step 2 — Run critical code in a Python shell (no HTTP)

These snippets import the module and call local-only functions.
Nothing touches the network.

```bash
python -c "
from app.core.config import settings
print('NOMAD_URL:       ', settings.NOMAD_URL)
print('MOCK_MODE:       ', settings.NOMAD_MOCK_MODE)
print('nomad_enabled:   ', settings.nomad_enabled)
print('/test/ in URL:   ', '/test/' in settings.NOMAD_URL)
assert '/test/' in settings.NOMAD_URL, 'URL DOES NOT CONTAIN /test/!'
assert settings.NOMAD_MOCK_MODE, 'MOCK MODE IS OFF!'
print('✓ Config is safe')
"
```

```bash
python -c "
from app.services.nomad import create_secure_zip, create_nomad_metadata_yaml

yaml = create_nomad_metadata_yaml(
    experiment_name='Safety Check',
    substrates=[],
    measurement_files=[{'fileName': 'test.txt', 'fileType': 'JV'}],
    device_groups=[],
)
print(yaml)

zp = create_secure_zip([('test.txt', b'hello')], archive_name='safety_check.zip')
print(f'Created zip: {zp}  ({zp.stat().st_size} bytes)')
zp.unlink()
print('✓ Local functions work — no HTTP involved')
"
```

---

## Step 3 — Run the full test suite (all mocked, zero network)

```bash
pytest tests/services/test_nomad.py -v --tb=short
```

All 20 tests should pass.  Groups A–D use `@patch("httpx.Client")`,
group E uses `side_effect=AssertionError(...)` to **assert httpx is
never even constructed** with mock mode on.

| Group | Tests | What they prove |
|-------|-------|-----------------|
| A — API Addresses | 6 | URLs are correctly built for `/test/` |
| B — Auth Token | 4 | Credential validation + mocked auth |
| C — Archive Upload | 3 | Zip safety + mocked upload |
| D — Full Cycle | 2 | End-to-end mocked workflow + URL audit |
| E — Mock Mode | 5 | `NOMAD_MOCK_MODE=true` blocks all HTTP |

---

## Step 4 — Use mock mode through the running app

With `NOMAD_MOCK_MODE=true` you can exercise every API endpoint.
The backend will log `[MOCK MODE] ...` lines instead of sending traffic.

```bash
# Watch the backend logs in another terminal
docker compose logs -f backend
```

Then trigger an upload from the frontend (or curl):

```bash
curl -s http://localhost:8000/api/v1/nomad/config \
     -H "Authorization: Bearer <your_jwt>" | python -m json.tool
```

The `processing_status` will be `"mock"` and `upload_id` will start
with `MOCK_`.  Check the backend log — you should see lines like:

```
[MOCK MODE] get_nomad_token — would POST …/auth/token …
[MOCK MODE] upload_to_nomad — would POST …/uploads …
```

No traffic leaves the container.

---

## Step 5 — Switch to real TEST server

Only do this when steps 1–4 pass and you are ready.

```bash
# In .env:
NOMAD_MOCK_MODE=false
NOMAD_USERNAME=your_nomad_test_account@example.com
NOMAD_PASSWORD=your_password
```

Restart the backend so it picks up the new env vars:

```bash
docker compose restart backend
```

Verify once more:

```bash
docker compose exec backend python -c "
from app.core.config import settings
assert '/test/' in settings.NOMAD_URL
assert not settings.NOMAD_MOCK_MODE
print('Ready for REAL test-server upload')
"
```

Now the upload will go to `https://nomad-lab.eu/prod/v1/test/api/v1`.
This is the **test** deployment — uploads there can be freely deleted.

---

## Quick reference — safety layers

| Layer | What it does |
|-------|-------------|
| `NOMAD_MOCK_MODE=true` | Replaces all HTTP with logged no-ops |
| `NOMAD_URL` default | Points to `/test/` deployment |
| `NOMAD_USERNAME=` (empty) | `nomad_enabled` → `False`, upload endpoint refuses |
| Test suite group E | Proves `httpx.Client` is never constructed in mock mode |
| Test suite group A+D | Proves all constructed URLs contain `/test/` |
