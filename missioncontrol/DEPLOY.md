# Deploying Mission Control to Northflank

Mission Control runs alongside OpenClaw on Northflank using the same wrapper server pattern. The Northflank template's `server.js` proxies `/missioncontrol` to an internal Bun process on port 18790.

## Architecture

```
Internet → Northflank (PORT 8080)
              │
              ├─ /healthz              → wrapper (no auth)
              ├─ /setup/*              → wrapper setup wizard
              ├─ /missioncontrol/*     → proxy to 127.0.0.1:18790 (Mission Control)
              └─ /*                    → proxy to 127.0.0.1:18789 (OpenClaw gateway)

Persistent volume: /data
  ├─ /data/.openclaw/          OpenClaw state
  ├─ /data/.gstack/            Mission Control state
  │   ├─ missioncontrol.json        Board state (cards)
  │   ├─ missioncontrol-server.json  Server state (pid, port, token)
  │   └─ missioncontrol-logs/        Skill execution logs
  └─ /data/npm, /data/pnpm     Package caches
```

## Changes Required

You need to modify two files in the `clawdbot-northflank-zebclaw` repo:

### 1. Dockerfile — Install Bun and build Mission Control

Add these lines after the existing build stage:

```dockerfile
# ── Mission Control build stage ──────────────────────────────────
FROM oven/bun:1 AS mc-build
WORKDIR /mc

# Copy missioncontrol source from gstack
COPY missioncontrol/ ./

# Compile CLI binary
RUN bun build --compile src/cli.ts --outfile dist/missioncontrol

# ── Runtime stage (modify existing) ──────────────────────────────
# ... existing runtime FROM line ...

# Add Bun runtime (needed to run server.ts)
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
COPY --from=oven/bun:1 /usr/local/bin/bunx /usr/local/bin/bunx

# Copy Mission Control binary and source
COPY --from=mc-build /mc/dist/missioncontrol /missioncontrol/dist/missioncontrol
COPY --from=mc-build /mc/src/ /missioncontrol/src/
RUN echo "built" > /missioncontrol/dist/.version
```

Alternatively, if you don't want a multi-stage build, copy the gstack missioncontrol source into the repo and build inline:

```dockerfile
# In the runtime stage
RUN curl -fsSL https://bun.sh/install | bash
COPY missioncontrol/src/ /missioncontrol/src/
RUN /root/.bun/bin/bun build --compile /missioncontrol/src/cli.ts --outfile /missioncontrol/dist/missioncontrol
```

### 2. server.js — Add Mission Control proxy route

In `clawdbot-northflank-zebclaw/src/server.js`, add the Mission Control proxy after the existing health/setup routes but **before** the catch-all OpenClaw proxy.

```javascript
// ── Mission Control ─────────────────────────────────────────────
const MC_INTERNAL_PORT = process.env.MC_INTERNAL_PORT || '18790';
const MC_INTERNAL_HOST = process.env.MC_INTERNAL_HOST || '127.0.0.1';
let mcProcess = null;

function startMissionControl() {
  if (mcProcess) return;

  const mcEnv = {
    ...process.env,
    MC_PORT: MC_INTERNAL_PORT,
    MC_STATE_FILE: '/data/.gstack/missioncontrol-server.json',
    MISSION_CONTROL_PASSWORD: process.env.MISSION_CONTROL_PASSWORD || process.env.SETUP_PASSWORD || '',
    OPENCLAW_WEBHOOK_URL: `http://127.0.0.1:${process.env.INTERNAL_GATEWAY_PORT || '18789'}/hooks`,
  };

  mcProcess = require('child_process').spawn(
    'bun', ['run', '/missioncontrol/src/server.ts'],
    { env: mcEnv, stdio: 'inherit' }
  );

  mcProcess.on('exit', (code) => {
    console.log(`[missioncontrol] Process exited with code ${code}`);
    mcProcess = null;
    // Auto-restart after 2 seconds
    setTimeout(startMissionControl, 2000);
  });

  console.log(`[missioncontrol] Starting on ${MC_INTERNAL_HOST}:${MC_INTERNAL_PORT}`);
}

// Start Mission Control when the wrapper starts
startMissionControl();

// Proxy /missioncontrol/* to internal Mission Control server
// Strip the /missioncontrol prefix before forwarding
app.all('/missioncontrol/*', (req, res) => {
  const target = `http://${MC_INTERNAL_HOST}:${MC_INTERNAL_PORT}`;
  // Rewrite path: /missioncontrol/api/state → /api/state
  // /missioncontrol → /
  const rewrittenPath = req.url.replace(/^\/missioncontrol\/?/, '/') || '/';

  proxy.web(req, res, {
    target,
    changeOrigin: true,
    // http-proxy pathRewrite isn't built-in; override the path
    selfHandleResponse: false,
  }, (err) => {
    console.error(`[missioncontrol] Proxy error: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Mission Control unavailable' }));
  });

  // Rewrite the URL for the proxied request
  req.url = rewrittenPath;
});
```

> **Note on path rewriting:** `http-proxy` doesn't have built-in path rewrite. The simplest approach is to set `req.url` before the proxy call. If using the existing proxy instance, just add a middleware that rewrites `req.url` before the catch-all:

```javascript
// Simpler alternative — add before the catch-all proxy
app.use('/missioncontrol', (req, res, next) => {
  req.url = req.url.replace(/^\/missioncontrol/, '') || '/';
  next();
});

// Then proxy /missioncontrol to MC internal
app.use('/missioncontrol', (req, res) => {
  proxy.web(req, res, {
    target: `http://${MC_INTERNAL_HOST}:${MC_INTERNAL_PORT}`,
  }, (err) => {
    console.error(`[missioncontrol] Proxy error: ${err.message}`);
    res.writeHead(502).end(JSON.stringify({ error: 'Mission Control unavailable' }));
  });
});
```

Place this **above** the existing catch-all `app.all('*', ...)` block.

### 3. Mission Control server.ts — Handle path prefix

The board UI fetches `/api/state`, but behind the Northflank proxy it's accessed at `/missioncontrol/api/state`. The proxy rewrites the path, so API calls work as-is. But the HTML page's `fetch()` calls need to know the base path.

Add this to `server.ts` — pass a base path to the UI:

```typescript
// In the fetch handler, for GET /
const basePath = process.env.MC_BASE_PATH || '';
return new Response(generateBoardHTML(basePath), {
  headers: { 'Content-Type': 'text/html' }
});
```

And in `ui.ts`, prepend `basePath` to all fetch URLs:

```javascript
const BASE_PATH = '${basePath}';
// fetch(BASE_PATH + '/api/state', ...)
```

Set `MC_BASE_PATH=/missioncontrol` in the Northflank env.

> **Shortcut:** If the proxy correctly rewrites paths (strips `/missioncontrol` prefix before forwarding), this step is unnecessary — the server sees `/api/state` directly.

## Environment Variables

Add these to your Northflank service environment:

| Variable | Required | Description |
|----------|----------|-------------|
| `MISSION_CONTROL_PASSWORD` | No | Password for the board UI. Falls back to `SETUP_PASSWORD` if unset. If both are empty, no auth. |
| `OPENCLAW_WEBHOOK_URL` | No | Auto-configured by the wrapper to `http://127.0.0.1:18789/hooks`. Only set manually if your gateway is on a different port. |
| `MC_PORT` | No | Internal port. Default `18790`. |
| `MC_BASE_PATH` | No | Set to `/missioncontrol` if the proxy does NOT strip the prefix. Leave empty if it does. |

## Deploy Steps

1. **Copy missioncontrol source** into `clawdbot-northflank-zebclaw`:

   ```bash
   cp -r ~/.claude/skills/gstack/missioncontrol/ \
         ~/Projects/highvoltagejobs/clawdbot-northflank-zebclaw/missioncontrol/
   ```

2. **Edit the Dockerfile** — add the Bun + Mission Control build steps (see above).

3. **Edit `src/server.js`** — add the Mission Control proxy route (see above).

4. **Set environment variables** in Northflank dashboard:
   - `MISSION_CONTROL_PASSWORD` → your chosen password

5. **Push and deploy:**

   ```bash
   cd ~/Projects/highvoltagejobs/clawdbot-northflank-zebclaw
   git add -A
   git commit -m "feat: add Mission Control deployment"
   git push origin main
   ```

   Northflank auto-deploys on push to main.

6. **Access the board:**

   ```
   https://p01--openclaw-service--26x5b4fkwbn2.code.run/missioncontrol
   ```

## Health Check

The existing `/healthz` endpoint in the wrapper remains the primary health check for Northflank. Optionally, extend it to check Mission Control:

```javascript
app.get('/healthz', async (req, res) => {
  // Existing gateway health check...

  // Also check Mission Control
  try {
    const mcHealth = await fetch(`http://127.0.0.1:${MC_INTERNAL_PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const mcData = await mcHealth.json();
    if (mcData.status !== 'healthy') {
      return res.status(503).json({ status: 'unhealthy', reason: 'missioncontrol' });
    }
  } catch {
    // MC not running — non-fatal, it auto-restarts
  }

  res.json({ status: 'ok' });
});
```

## Persistent Storage

Mission Control state lives on the Northflank volume at `/data/.gstack/`. This directory is created automatically by `ensureStateDir()`. The volume persists across deploys and restarts — your board state and logs survive redeployments.

## Troubleshooting

**Board shows "Connection error" (red dot):**
- Check if MC process is running: the wrapper auto-restarts it on crash
- Check Northflank logs for `[missioncontrol]` prefixed messages
- Verify port 18790 isn't conflicting with another service

**401 on all API calls:**
- Verify `MISSION_CONTROL_PASSWORD` matches what you entered in the login form
- Clear cookies and re-login
- If no password is set, auth should be disabled entirely

**Webhook not triggering OpenClaw:**
- Check `OPENCLAW_WEBHOOK_URL` resolves to the gateway
- Verify the gateway is running on port 18789
- Check Northflank logs for webhook POST errors

**State lost after deploy:**
- Ensure the Northflank volume is mounted at `/data`
- Verify `MC_STATE_FILE` points to `/data/.gstack/missioncontrol-server.json`
