const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const dns = require("node:dns").promises;
const ipaddr = require("ipaddr.js");
const path = require("node:path");
const fs = require("node:fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "orbit.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 event_type TEXT NOT NULL,
 detail TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";
if (adminEmail && adminPassword && !db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail)) {
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare("INSERT INTO users(email,password_hash,role) VALUES(?,?, 'admin')").run(adminEmail, hash);
}

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(session({
  name: "orbit.sid",
  secret: process.env.SESSION_SECRET || "dev-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 }
}));
app.use(express.static(path.join(__dirname, "public")));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const proxyLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

function logEvent(userId, type, detail = "") {
  db.prepare("INSERT INTO events(user_id,event_type,detail) VALUES(?,?,?)").run(userId || null, type, String(detail).slice(0, 500));
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in first." });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  next();
}
function safePublicAddress(address) {
  try {
    const parsed = ipaddr.parse(address);
    return parsed.range() === "unicast";
  } catch { return false; }
}
async function validatePublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid web address."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS addresses are supported.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("That address is not allowed.");
  const records = await dns.lookup(host, { all: true });
  if (!records.length || records.some(r => !safePublicAddress(r.address))) throw new Error("Private or local network addresses are blocked.");
  return url;
}

app.post("/api/signup", authLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
    return res.status(400).json({ error: "Use a valid email and a password with at least 10 characters." });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users(email,password_hash) VALUES(?,?)").run(email, hash);
    req.session.user = { id: Number(result.lastInsertRowid), email, role: "user" };
    logEvent(req.session.user.id, "signup", "New account created");
    res.json({ user: req.session.user });
  } catch {
    res.status(409).json({ error: "An account with that email already exists." });
  }
});
app.post("/api/login", authLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  req.session.user = { id: user.id, email: user.email, role: user.role };
  logEvent(user.id, "login", "Signed in");
  res.json({ user: req.session.user });
});
app.post("/api/logout", requireAuth, (req, res) => {
  logEvent(req.session.user.id, "logout", "Signed out");
  req.session.destroy(() => res.json({ ok: true }));
});
app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));

// MVP fetch proxy: retrieves public HTML through the Orbit server.
// It is intentionally not a full remote browser: complex sites, logins, JS apps,
// streaming media and many asset paths need a dedicated remote-browser service.
app.get("/api/proxy", requireAuth, proxyLimiter, async (req, res) => {
  try {
    const url = await validatePublicUrl(String(req.query.url || ""));
    const upstream = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "OrbitBrowser/1.0 (+user-requested web preview)", "Accept": "text/html,application/xhtml+xml" }
    });
    const type = upstream.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
      return res.status(415).json({ error: "This MVP proxy preview supports HTML pages only." });
    }
    const html = await upstream.text();
    if (html.length > 2_000_000) return res.status(413).json({ error: "Page is too large for this preview." });
    logEvent(req.session.user.id, "proxy_visit", url.hostname);
    res.set("Content-Type", "text/plain; charset=utf-8");
    res.send(html);
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not load that page." });
  }
});

app.get("/api/admin/overview", requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id,email,role,created_at FROM users ORDER BY id DESC LIMIT 200").all();
  const events = db.prepare(`
    SELECT events.id, users.email, events.event_type, events.detail, events.created_at
    FROM events LEFT JOIN users ON users.id=events.user_id
    ORDER BY events.id DESC LIMIT 250
  `).all();
  const counts = {
    users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
    visits: db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type='proxy_visit'").get().n,
    activeSessions: null
  };
  res.json({ users, events, counts });
});

app.listen(PORT, () => console.log(`Orbit is running on http://localhost:${PORT}`));
