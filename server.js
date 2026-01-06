const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { db, run, get, all, initDB, DB_PATH } = require("./database");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "FLISS_SECRET_CHANGE_ME";

function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
}

function adminRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (req.user.role !== "super_admin" && req.user.role !== "admin") {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }
  next();
}

async function seedAdmin() {
  const email = "ghassen@thefliss.com";
  const exists = await get("SELECT id FROM users WHERE email = ?", [email]);
  if (exists) {
    console.log("ℹ️ Admin déjà existant");
    return;
  }
  const hash = await bcrypt.hash("Fqtu548re@", 10);
  await run(
    "INSERT INTO users (email, password_hash, role, company, agencies) VALUES (?,?,?,?,?)",
    [email, hash, "super_admin", "THEFLISS", "Valence,Pierrelatte"]
  );
  console.log("✅ Admin auto-créé");
}

app.get("/", (req, res) => res.send("Fliss backend OK"));
app.get("/health", (req, res) => res.json({ ok: true, db: "sqlite", path: DB_PATH }));

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: "Champs manquants" });

    const user = await get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) return res.status(401).json({ ok: false, error: "Identifiants invalides" });

    const ok = await bcrypt.compare(password, user.password_hash || "");
    if (!ok) return res.status(401).json({ ok: false, error: "Identifiants invalides" });

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role || "user",
      company: user.company || "",
      agencies: user.agencies || ""
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });

    return res.json({ ok: true, token, user: payload });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Erreur serveur" });
  }
});

// Users (admin)
app.get("/api/users", authRequired, adminRequired, async (req, res) => {
  const users = await all("SELECT id, email, role, company, agencies FROM users ORDER BY id DESC");
  res.json({ ok: true, users });
});

app.post("/api/users", authRequired, adminRequired, async (req, res) => {
  try {
    const { email, password, role, company, agencies } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: "Email et mot de passe requis" });
    const hash = await bcrypt.hash(password, 10);
    await run(
      "INSERT INTO users (email, password_hash, role, company, agencies) VALUES (?,?,?,?,?)",
      [email, hash, role || "user", company || "", agencies || ""]
    );
    res.json({ ok: true });
  } catch (e) {
    const msg = String(e && e.message || "");
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      return res.status(409).json({ ok: false, error: "Utilisateur déjà existant" });
    }
    console.error(e);
    return res.status(500).json({ ok: false, error: "Erreur serveur" });
  }
});

// ===============================
// SALES (from the existing caisse)
// ===============================

// Create / upsert a sale (idempotent)
app.post("/api/sales", authRequired, async (req, res) => {
  const u = req.user;
  const role = u.role;
  if (!role || !["super_admin", "admin", "caissier", "cashier"].includes(role)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const sale = req.body || {};
  const id = String(sale.id || sale.sale_id || sale.uid || "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "missing_id" });

  const company = String(sale.company || u.company || "THEFLISS").trim();
  const agency = String(sale.agency || sale.store || sale.point_of_sale || "").trim();
  const seller = String(sale.seller || sale.user || u.email || "").trim();
  const totalCents = Math.round(Number(sale.total_cents ?? sale.totalCents ?? sale.total ?? 0) * (sale.total_cents != null || sale.totalCents != null ? 1 : 100));
  const payloadJson = JSON.stringify(sale);

  try {
    await run(
      `INSERT INTO sales (id, company, agency, seller, total_cents, payload_json)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         company=excluded.company,
         agency=excluded.agency,
         seller=excluded.seller,
         total_cents=excluded.total_cents,
         payload_json=excluded.payload_json`,
      [id, company, agency, seller, totalCents, payloadJson]
    );
    return res.json({ ok: true, id });
  } catch (e) {
    console.error("/api/sales insert", e);
    return res.status(500).json({ ok: false, error: "db" });
  }
});

// List sales (role-based)
app.get("/api/sales", authRequired, async (req, res) => {
  const u = req.user;
  const role = u.role;
  const qCompany = String(req.query.company || u.company || "").trim();
  const qAgency = String(req.query.agency || "").trim();

  // Role-based scoping
  let company = qCompany;
  let agenciesAllowed = null;
  if (role === "super_admin") {
    // super_admin can see everything (optionally filtered)
  } else {
    company = u.company;
    agenciesAllowed = String(u.agencies || "").split(",").map(s => s.trim()).filter(Boolean);
  }

  const where = [];
  const params = [];
  if (company) {
    where.push("company = ?");
    params.push(company);
  }
  if (qAgency) {
    where.push("agency = ?");
    params.push(qAgency);
  } else if (agenciesAllowed && agenciesAllowed.length) {
    where.push(`agency IN (${agenciesAllowed.map(() => "?").join(",")})`);
    params.push(...agenciesAllowed);
  }

  const sql = `SELECT id, company, agency, seller, total_cents, payload_json, created_at
               FROM sales
               ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY datetime(created_at) DESC
               LIMIT 2000`;
  try {
    const rows = await all(sql, params);
    const sales = rows.map(r => {
      let payload = null;
      try { payload = JSON.parse(r.payload_json || "null"); } catch {}
      return {
        id: r.id,
        company: r.company,
        agency: r.agency,
        seller: r.seller,
        total_cents: r.total_cents,
        created_at: r.created_at,
        ...payload
      };
    });
    return res.json({ ok: true, sales });
  } catch (e) {
    console.error("/api/sales list", e);
    return res.status(500).json({ ok: false, error: "db" });
  }
});

// Delete a sale
app.delete("/api/sales/:id", authRequired, adminRequired, async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "missing_id" });
  try {
    await run(`DELETE FROM sales WHERE id = ?`, [id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("/api/sales delete", e);
    return res.status(500).json({ ok: false, error: "db" });
  }
});

async function main() {
  await initDB();            // ✅ migration-safe
  await seedAdmin();         // ✅ no crash if table older
  app.listen(PORT, () => console.log("✅ Backend Fliss prêt sur", PORT));
}

main().catch((e) => {
  console.error("❌ Boot error:", e);
  process.exit(1);
});
