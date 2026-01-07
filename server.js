const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { db, run, get, all, initDB, DB_PATH } = require("./database");

const app = express();

/* =========================
   CORS — CORRECTION TOTALE
========================= */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());

app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "FLISS_SECRET_CHANGE_ME";

/* =========================
   AUTH MIDDLEWARES
========================= */
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
  if (!["super_admin", "admin"].includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }
  next();
}

/* =========================
   SEED SUPER ADMIN
========================= */
async function seedAdmin() {
  const email = "ghassen@thefliss.com";
  const exists = await get("SELECT id FROM users WHERE email = ?", [email]);
  if (exists) return;
  const hash = await bcrypt.hash("Fqtu548re@", 10);
  await run(
    "INSERT INTO users (email, password_hash, role, company, agencies) VALUES (?,?,?,?,?)",
    [email, hash, "super_admin", "THEFLISS", "Valence,Pierrelatte"]
  );
  console.log("✅ Admin auto-créé");
}

/* =========================
   HEALTH
========================= */
app.get("/", (req, res) => res.send("Fliss backend OK"));
app.get("/health", (req, res) => res.json({ ok: true, db: "sqlite", path: DB_PATH }));

/* =========================
   LOGIN
========================= */
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "Champs manquants" });
  }

  const user = await get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) return res.status(401).json({ ok: false, error: "Identifiants invalides" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ ok: false, error: "Identifiants invalides" });

  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    company: user.company || "",
    agencies: user.agencies || ""
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
  res.json({ ok: true, token, user: payload });
});

/* =========================
   USERS — CRÉATION OUVERTE
   (OBLIGATOIRE POUR TON SITE)
========================= */
app.post("/api/users", async (req, res) => {
  try {
    const { email, password, role, company, agencies } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email et mot de passe requis" });
    }

    const exists = await get("SELECT id FROM users WHERE email = ?", [email]);
    if (exists) {
      return res.status(409).json({ ok: false, error: "Utilisateur déjà existant" });
    }

    const hash = await bcrypt.hash(password, 10);
    await run(
      "INSERT INTO users (email, password_hash, role, company, agencies) VALUES (?,?,?,?,?)",
      [email, hash, role || "client", company || "THEFLISS", agencies || ""]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Erreur serveur" });
  }
});

/* =========================
   USERS — LISTE (ADMIN)
========================= */
app.get("/api/users", authRequired, adminRequired, async (req, res) => {
  const users = await all("SELECT id, email, role, company, agencies FROM users ORDER BY id DESC");
  res.json({ ok: true, users });
});

/* =========================
   SALES
========================= */
app.post("/api/sales", authRequired, async (req, res) => {
  const u = req.user;
  if (!["super_admin", "admin", "caissier", "cashier"].includes(u.role)) {
    return res.status(403).json({ ok: false });
  }

  const sale = req.body || {};
  const id = String(sale.id || sale.uid || "").trim();
  if (!id) return res.status(400).json({ ok: false });

  await run(
    `INSERT INTO sales (id, company, agency, seller, total_cents, payload_json)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
     company=excluded.company,
     agency=excluded.agency,
     seller=excluded.seller,
     total_cents=excluded.total_cents,
     payload_json=excluded.payload_json`,
    [
      id,
      sale.company || u.company,
      sale.agency || "",
      sale.seller || u.email,
      Number(sale.total_cents || 0),
      JSON.stringify(sale)
    ]
  );

  res.json({ ok: true });
});

app.get("/api/sales", authRequired, async (req, res) => {
  const rows = await all("SELECT * FROM sales ORDER BY created_at DESC LIMIT 2000");
  res.json({ ok: true, sales: rows });
});

app.delete("/api/sales/:id", authRequired, adminRequired, async (req, res) => {
  await run("DELETE FROM sales WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

/* =========================
   BOOT
========================= */
async function main() {
  await initDB();
  await seedAdmin();
  app.listen(PORT, () => console.log("✅ Backend Fliss prêt sur", PORT));
}

main().catch(e => {
  console.error("❌ Boot error:", e);
  process.exit(1);
});
