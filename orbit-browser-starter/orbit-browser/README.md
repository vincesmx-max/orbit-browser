# Orbit Browser — starter project

Orbit is a cross-browser web app shell designed to run in current Chrome, Edge and Safari. It includes account signup/login, a SQLite user store, an admin activity view, and a guarded server-side HTML fetch preview.

## Important scope note

This is a working **MVP starter**, not yet a full proxy browser. The current proxy endpoint fetches public HTML through the server and displays the response as text. It does not render arbitrary sites as a browser would, and it will not reliably support JavaScript-heavy sites, media, third-party cookies, logins, or complex assets.

A full browsing experience needs a remote browser service (for example, isolated Playwright/Chromium sessions) with streamed screen/input, per-user browser contexts, strict resource limits, and additional abuse/SSRF protections. Do not describe this MVP as a fully functional general-purpose proxy.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set a long random `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

The first configured admin account is created at startup if it does not already exist. Keep `.env` private.

## Deployment checklist

- Deploy to a Node.js host with persistent disk storage for `data/orbit.sqlite`.
- Set `NODE_ENV=production`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `APP_ORIGIN`.
- Terminate HTTPS at the host or reverse proxy.
- Replace Express's in-memory session store with a persistent production session store.
- Add CSRF protection, email verification, password reset, account deletion, backups, audit retention controls, and stronger abuse monitoring.
- For the full proxy, use isolated remote browser workers. Never expose a raw open proxy or browser debugging port to the public internet.
- Review privacy and logging rules before recording browsing history. This MVP records proxy hostnames in the admin event log.

## Admin

Sign in with the account configured by `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The Admin console appears for that account only.
