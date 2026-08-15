// server.js — Pradip 2.0 backend
// Serves the static app and syncs data across devices via a simple PIN.
// Each PIN maps to one JSON blob holding the entire app state.

import express from "express";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "8mb" }));

const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;
let dbReady = false;

if (DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("railway.internal") ? false : { rejectUnauthorized: false },
  });
}

async function ensureTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_data (
      pin TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  dbReady = true;
  console.log("DB ready: user_data table ensured.");
}

function isValidPin(pin) {
  return typeof pin === "string" && /^[0-9]{4,10}$/.test(pin);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, dbConfigured: !!pool, dbReady });
});

app.get("/api/state", async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: "Database not configured yet." });
    const pin = String(req.query.pin || "").trim();
    if (!isValidPin(pin)) return res.status(400).json({ error: "PIN must be 4-10 digits." });
    const r = await pool.query("SELECT data FROM user_data WHERE pin = $1", [pin]);
    if (r.rows.length === 0) {
      res.json({ data: {}, isNew: true });
    } else {
      res.json({ data: r.rows[0].data || {}, isNew: false });
    }
  } catch (err) {
    console.error("GET /api/state error:", err);
    res.status(500).json({ error: "Server error loading data." });
  }
});

app.post("/api/state", async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: "Database not configured yet." });
    const { pin, data } = req.body || {};
    if (!isValidPin(pin)) return res.status(400).json({ error: "PIN must be 4-10 digits." });
    if (typeof data !== "object" || data === null) {
      return res.status(400).json({ error: "Invalid data payload." });
    }
    await pool.query(
      `INSERT INTO user_data (pin, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (pin) DO UPDATE SET data = $2, updated_at = now()`,
      [pin, data]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/state error:", err);
    res.status(500).json({ error: "Server error saving data." });
  }
});

// Serve the app for every other route (single static file)
app.use(express.static(__dirname));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Pradip 2.0 server listening on port " + PORT);
  ensureTable().catch((e) => console.error("Failed to ensure table:", e.message));
});
