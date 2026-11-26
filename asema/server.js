import "dotenv/config";
import express from "express";
import session from "express-session";
import mysql from "mysql2/promise";
import { dbConfig, dbName } from "./db-config.js";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const db = mysql.createPool({
  ...dbConfig,
  database: dbName,
  decimalNumbers: true,
  dateStrings: true,
  connectionLimit: 10,
});
// Совместимость с разными версиями MySQL/облачными серверами
db.pool.on("connection", (c) => c.query("SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''))"));
const q = async (sql, p = []) => (await db.query(sql, p))[0];

// Сессии хранятся в MySQL, поэтому не пропадают при перезапуске сервера
class MySQLSessionStore extends session.Store {
  get(sid, cb) { q("SELECT data FROM sessions WHERE sid=? AND expires>?", [sid, Date.now()]).then(([r]) => cb(null, r ? JSON.parse(r.data) : null)).catch(cb); }
  set(sid, sess, cb) {
    const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 3600 * 1000;
    q("INSERT INTO sessions (sid, data, expires) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data), expires=VALUES(expires)", [sid, JSON.stringify(sess), exp]).then(() => cb(null)).catch(cb);
  }
  destroy(sid, cb) { q("DELETE FROM sessions WHERE sid=?", [sid]).then(() => cb(null)).catch(cb); }
}
setInterval(() => q("DELETE FROM sessions WHERE expires<?", [Date.now()]).catch(() => {}), 3600 * 1000);

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) { console.error("Задайте SESSION_SECRET"); process.exit(1); }

const STATUSES = ["в эксплуатации", "на складе", "на ремонте", "неисправно", "списано"];
const REPAIR = ["новая", "принята", "в работе", "ожидает запчасти", "выполнена", "отклонена"];
const PRIORITY = ["низкий", "средний", "высокий"];
const today = () => new Date().toISOString().slice(0, 10);

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => { res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" }); next(); });
app.get("/health", (req, res) => res.send("ok"));
app.use(session({
  store: new MySQLSessionStore(),
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 3600 * 1000 },
}));
app.use(express.static(path.join(dir, "public")));

// ---------- помощники ----------
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Такой инвентарный номер или логин уже существует" });
    if (e.code === "ER_ROW_IS_REFERENCED_2") return res.status(409).json({ error: "Нельзя удалить: есть связанные записи" });
    console.error(e);
    res.status(500).json({ error: "Ошибка сервера" });
  });
const auth = (...roles) => (req, res, next) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ error: "Требуется вход" });
  if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: "Недостаточно прав" });
  next();
};
const bad = (res, msg) => res.status(400).json({ error: msg });
const log = (req, action, details) =>
  q("INSERT INTO audit_log (user_name, action, details) VALUES (?,?,?)", [req.session.user.name, action, details]);
const text = (v, max = 150) => String(v ?? "").trim().slice(0, max);

// ---------- вход ----------
const fails = new Map();
app.post("/api/login", wrap(async (req, res) => {
  const f = fails.get(req.ip) || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 15 * 60 * 1000) { f.n = 0; f.t = Date.now(); }
  if (f.n >= 10) return res.status(429).json({ error: "Слишком много попыток, подождите 15 минут" });
  const [u] = await q("SELECT * FROM users WHERE login = ?", [text(req.body.login, 50)]);
  if (!u || !(await bcrypt.compare(String(req.body.password ?? ""), u.password_hash))) {
    f.n++; fails.set(req.ip, f);
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }
  fails.delete(req.ip);
  req.session.user = { id: u.id, name: u.name, role: u.role, teacherId: u.teacher_id };
  res.json(req.session.user);
}));
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", auth(), (req, res) => res.json(req.session.user));

// ---------- справочники ----------
app.get("/api/categories", auth(), wrap(async (req, res) => res.json(await q("SELECT * FROM categories ORDER BY id"))));

app.get("/api/teachers", auth(), wrap(async (req, res) => res.json(await q(
  `SELECT t.*, GROUP_CONCAT(DISTINCT r.number SEPARATOR ', ') rooms, COUNT(a.id) assets, COALESCE(SUM(a.cost),0) total
   FROM teachers t LEFT JOIN rooms r ON r.teacher_id = t.id LEFT JOIN assets a ON a.room_id = r.id
   GROUP BY t.id ORDER BY t.name`))));
app.post("/api/teachers", auth("admin"), wrap(async (req, res) => {
  const { name, subject, phone } = req.body;
  if (!text(name)) return bad(res, "Укажите ФИО");
  const r = await q("INSERT INTO teachers (name, subject, phone) VALUES (?,?,?)", [text(name, 100), text(subject, 100), text(phone, 30)]);
  await log(req, "teacher+", text(name)); res.json({ id: r.insertId });
}));
app.put("/api/teachers/:id", auth("admin"), wrap(async (req, res) => {
  const { name, subject, phone } = req.body;
  if (!text(name)) return bad(res, "Укажите ФИО");
  await q("UPDATE teachers SET name=?, subject=?, phone=? WHERE id=?", [text(name, 100), text(subject, 100), text(phone, 30), req.params.id]);
  await log(req, "teacher~", text(name)); res.json({ ok: true });
}));
app.delete("/api/teachers/:id", auth("admin"), wrap(async (req, res) => {
  await q("DELETE FROM teachers WHERE id=?", [req.params.id]);
  await log(req, "teacher-", "id " + req.params.id); res.json({ ok: true });
}));

app.get("/api/rooms", auth(), wrap(async (req, res) => res.json(await q(
  `SELECT r.*, t.name teacher, COUNT(a.id) assets, COALESCE(SUM(a.cost),0) total
   FROM rooms r LEFT JOIN teachers t ON t.id = r.teacher_id LEFT JOIN assets a ON a.room_id = r.id
   GROUP BY r.id ORDER BY r.id`))));
const roomVals = (b) => [text(b.number, 20), text(b.name, 100), text(b.building, 50), +b.floor || 0, b.teacher_id || null];
app.post("/api/rooms", auth("admin"), wrap(async (req, res) => {
  if (!text(req.body.number) || !text(req.body.name)) return bad(res, "Укажите номер и название");
  const r = await q("INSERT INTO rooms (number, name, building, floor, teacher_id) VALUES (?,?,?,?,?)", roomVals(req.body));
  await log(req, "room+", text(req.body.number)); res.json({ id: r.insertId });
}));
app.put("/api/rooms/:id", auth("admin"), wrap(async (req, res) => {
  if (!text(req.body.number) || !text(req.body.name)) return bad(res, "Укажите номер и название");
  await q("UPDATE rooms SET number=?, name=?, building=?, floor=?, teacher_id=? WHERE id=?", [...roomVals(req.body), req.params.id]);
  await log(req, "room~", text(req.body.number)); res.json({ ok: true });
}));
app.delete("/api/rooms/:id", auth("admin"), wrap(async (req, res) => {
  await q("DELETE FROM rooms WHERE id=?", [req.params.id]);
  await log(req, "room-", "id " + req.params.id); res.json({ ok: true });
}));

// ---------- имущество ----------
app.get("/api/assets", auth(), wrap(async (req, res) => {
  const { q: s, status, categoryId, roomId, page = 1, limit = 10 } = req.query;
  const w = [], p = [];
  if (s) { w.push("(a.name LIKE ? OR a.inventory_no LIKE ?)"); p.push(`%${s}%`, `%${s}%`); }
  if (status) { w.push("a.status = ?"); p.push(status); }
  if (categoryId) { w.push("a.category_id = ?"); p.push(categoryId); }
  if (roomId) { w.push("a.room_id = ?"); p.push(roomId); }
  // Преподаватель видит только имущество своих кабинетов
  if (req.session.user.role === "teacher") { w.push("r.teacher_id = ?"); p.push(req.session.user.teacherId); }
  const base = `FROM assets a JOIN rooms r ON r.id = a.room_id LEFT JOIN teachers t ON t.id = r.teacher_id ${w.length ? "WHERE " + w.join(" AND ") : ""}`;
  const [{ n }] = await q(`SELECT COUNT(*) n ${base}`, p);
  const rows = await q(`SELECT a.*, r.number room, t.name teacher ${base} ORDER BY a.id LIMIT ? OFFSET ?`, [...p, +limit, (page - 1) * limit]);
  res.json({ total: n, rows });
}));
const assetOk = (b) => text(b.name) && text(b.inventory_no, 30) && b.category_id && +b.cost >= 0 && b.cost !== "";
app.post("/api/assets", auth("admin"), wrap(async (req, res) => {
  const b = req.body;
  if (!assetOk(b) || !b.room_id) return bad(res, "Заполните все поля (стоимость не меньше 0)");
  const r = await q("INSERT INTO assets (inventory_no, name, category_id, room_id, cost) VALUES (?,?,?,?,?)",
    [text(b.inventory_no, 30), text(b.name), b.category_id, b.room_id, +b.cost]);
  await q("INSERT INTO assignments (asset_id, room_id, date, reason) VALUES (?,?,?,?)", [r.insertId, b.room_id, today(), "Поступление"]);
  await log(req, "asset+", `${b.inventory_no} ${b.name}`); res.json({ id: r.insertId });
}));
app.put("/api/assets/:id", auth("admin"), wrap(async (req, res) => {
  const b = req.body;
  if (!assetOk(b)) return bad(res, "Заполните все поля (стоимость не меньше 0)");
  await q("UPDATE assets SET inventory_no=?, name=?, category_id=?, cost=? WHERE id=?", [text(b.inventory_no, 30), text(b.name), b.category_id, +b.cost, req.params.id]);
  await log(req, "asset~", `${b.inventory_no} ${b.name}`); res.json({ ok: true });
}));
app.patch("/api/assets/:id/move", auth("admin"), wrap(async (req, res) => {
  if (!req.body.room_id) return bad(res, "Выберите кабинет");
  await q("UPDATE assets SET room_id=? WHERE id=?", [req.body.room_id, req.params.id]);
  await q("INSERT INTO assignments (asset_id, room_id, date, reason) VALUES (?,?,?,?)", [req.params.id, req.body.room_id, today(), "Перемещение"]);
  await log(req, "move", `имущество ${req.params.id} → кабинет ${req.body.room_id}`); res.json({ ok: true });
}));
app.patch("/api/assets/:id/status", auth("admin"), wrap(async (req, res) => {
  if (!STATUSES.includes(req.body.status)) return bad(res, "Неверный статус");
  if (req.body.status === "списано") {
    const reason = text(req.body.reason, 255);
    if (!reason) return bad(res, "Укажите причину списания");
    await q("INSERT INTO writeoffs (asset_id, reason, date, created_by) VALUES (?,?,?,?)", [req.params.id, reason, today(), req.session.user.name]);
  } else await q("DELETE FROM writeoffs WHERE asset_id=?", [req.params.id]);
  await q("UPDATE assets SET status=? WHERE id=?", [req.body.status, req.params.id]);
  await log(req, "status", `имущество ${req.params.id}: ${req.body.status}`); res.json({ ok: true });
}));
app.delete("/api/assets/:id", auth("admin"), wrap(async (req, res) => {
  await q("DELETE FROM assets WHERE id=?", [req.params.id]);
  await log(req, "asset-", "id " + req.params.id); res.json({ ok: true });
}));
app.get("/api/assets/:id/history", auth(), wrap(async (req, res) => res.json(await q(
  "SELECT s.date, s.reason, r.number room FROM assignments s JOIN rooms r ON r.id = s.room_id WHERE s.asset_id = ? ORDER BY s.id", [req.params.id]))));

// ---------- ремонт ----------
app.get("/api/repairs", auth(), wrap(async (req, res) => {
  const teacher = req.session.user.role === "teacher";
  res.json(await q(
    `SELECT p.*, a.name asset, a.inventory_no, rm.number room FROM repairs p
     JOIN assets a ON a.id = p.asset_id JOIN rooms rm ON rm.id = a.room_id
     ${teacher ? "WHERE rm.teacher_id = ?" : ""} ORDER BY p.id DESC`, teacher ? [req.session.user.teacherId] : []));
}));
app.post("/api/repairs", auth("admin", "teacher"), wrap(async (req, res) => {
  const u = req.session.user, b = req.body;
  if (!b.asset_id || !text(b.description, 500)) return bad(res, "Выберите имущество и опишите проблему");
  const [a] = await q(`SELECT a.id FROM assets a JOIN rooms r ON r.id = a.room_id WHERE a.id = ? ${u.role === "teacher" ? "AND r.teacher_id = ?" : ""}`,
    u.role === "teacher" ? [b.asset_id, u.teacherId] : [b.asset_id]);
  if (!a) return bad(res, "Имущество не найдено");
  const priority = PRIORITY.includes(b.priority) ? b.priority : "средний";
  await q("INSERT INTO repairs (asset_id, description, priority, created_by, date) VALUES (?,?,?,?,?)", [a.id, text(b.description, 500), priority, u.name, today()]);
  await q("UPDATE assets SET status='на ремонте' WHERE id=?", [a.id]);
  await log(req, "repair+", `имущество ${a.id}`); res.json({ ok: true });
}));
app.patch("/api/repairs/:id/status", auth("admin", "technician"), wrap(async (req, res) => {
  if (!REPAIR.includes(req.body.status)) return bad(res, "Неверный статус");
  await q("UPDATE repairs SET status=? WHERE id=?", [req.body.status, req.params.id]);
  if (req.body.status === "выполнена")
    await q("UPDATE assets SET status='в эксплуатации' WHERE id=(SELECT asset_id FROM repairs WHERE id=?)", [req.params.id]);
  await log(req, "repair", `заявка ${req.params.id}: ${req.body.status}`); res.json({ ok: true });
}));

// ---------- главная и журнал ----------
app.get("/api/dashboard", auth("admin", "technician"), wrap(async (req, res) => {
  const [t] = await q("SELECT COUNT(*) n, COALESCE(SUM(cost),0) total FROM assets");
  const openSql = "FROM repairs r JOIN assets a ON a.id = r.asset_id WHERE r.status NOT IN ('выполнена','отклонена')";
  const [o] = await q(`SELECT COUNT(*) n ${openSql}`);
  const [nt] = await q("SELECT COUNT(*) n FROM rooms WHERE teacher_id IS NULL");
  res.json({
    count: t.n, total: t.total, open: o.n, noTeacher: nt.n,
    byStatus: await q("SELECT status, COUNT(*) n FROM assets GROUP BY status"),
    byCategory: await q("SELECT c.id, c.name, COUNT(a.id) n FROM categories c LEFT JOIN assets a ON a.category_id = c.id GROUP BY c.id ORDER BY c.id"),
    openList: await q(`SELECT a.name asset, r.description, r.status ${openSql} ORDER BY r.id DESC LIMIT 5`),
  });
}));
app.get("/api/log", auth("admin"), wrap(async (req, res) => res.json(await q("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200"))));

// ---------- списание ----------
app.get("/api/writeoffs", auth("admin"), wrap(async (req, res) => res.json(await q(
  "SELECT w.*, a.name asset, a.inventory_no, a.cost FROM writeoffs w JOIN assets a ON a.id = w.asset_id ORDER BY w.id DESC"))));

// ---------- инвентаризация ----------
const RESULTS = ["не проверено", "найдено", "не найдено", "повреждено"];
app.get("/api/inventory", auth("admin"), wrap(async (req, res) => res.json(await q(
  `SELECT c.*, r.number room, COUNT(i.id) total,
     COALESCE(SUM(i.result='найдено'),0) found, COALESCE(SUM(i.result='не найдено'),0) missing, COALESCE(SUM(i.result='повреждено'),0) damaged
   FROM inventory_checks c JOIN rooms r ON r.id = c.room_id LEFT JOIN inventory_items i ON i.check_id = c.id
   GROUP BY c.id, r.number ORDER BY c.id DESC`))));
app.post("/api/inventory", auth("admin"), wrap(async (req, res) => {
  if (!req.body.room_id) return bad(res, "Выберите кабинет");
  const items = await q("SELECT id FROM assets WHERE room_id = ? AND status <> 'списано'", [req.body.room_id]);
  if (!items.length) return bad(res, "В кабинете нет имущества для проверки");
  const r = await q("INSERT INTO inventory_checks (room_id, created_by) VALUES (?,?)", [req.body.room_id, req.session.user.name]);
  await q("INSERT INTO inventory_items (check_id, asset_id) VALUES ?", [items.map((a) => [r.insertId, a.id])]);
  await log(req, "inventory+", `кабинет ${req.body.room_id}`); res.json({ id: r.insertId });
}));
app.get("/api/inventory/:id", auth("admin"), wrap(async (req, res) => {
  const [c] = await q("SELECT c.*, r.number room FROM inventory_checks c JOIN rooms r ON r.id = c.room_id WHERE c.id = ?", [req.params.id]);
  if (!c) return res.status(404).json({ error: "Не найдено" });
  c.items = await q("SELECT i.id, i.result, a.inventory_no, a.name, a.category_id FROM inventory_items i JOIN assets a ON a.id = i.asset_id WHERE i.check_id = ? ORDER BY a.id", [c.id]);
  res.json(c);
}));
app.patch("/api/inventory/items/:id", auth("admin"), wrap(async (req, res) => {
  if (!RESULTS.includes(req.body.result)) return bad(res, "Неверный результат");
  const r = await q("UPDATE inventory_items i JOIN inventory_checks c ON c.id = i.check_id SET i.result = ? WHERE i.id = ? AND c.status = 'открыта'", [req.body.result, req.params.id]);
  if (!r.affectedRows) return bad(res, "Инвентаризация закрыта");
  res.json({ ok: true });
}));
app.post("/api/inventory/:id/close", auth("admin"), wrap(async (req, res) => {
  await q("UPDATE inventory_checks SET status='закрыта', closed_at=NOW() WHERE id=? AND status='открыта'", [req.params.id]);
  await log(req, "inventory", `закрыта № ${req.params.id}`); res.json({ ok: true });
}));

// ---------- пользователи ----------
const ROLES = ["admin", "technician", "teacher"];
const userOk = (b) => text(b.name, 100) && ROLES.includes(b.role) && (b.role !== "teacher" || b.teacher_id);
const onlyAdmin = async (id) => {
  const [u] = await q("SELECT role FROM users WHERE id=?", [id]);
  const [c] = await q("SELECT COUNT(*) n FROM users WHERE role='admin'");
  return u?.role === "admin" && c.n <= 1;
};
app.get("/api/users", auth("admin"), wrap(async (req, res) => res.json(await q(
  "SELECT u.id, u.name, u.login, u.role, u.teacher_id, t.name teacher FROM users u LEFT JOIN teachers t ON t.id = u.teacher_id ORDER BY u.id"))));
app.post("/api/users", auth("admin"), wrap(async (req, res) => {
  const b = req.body;
  if (!userOk(b) || !text(b.login, 50)) return bad(res, "Заполните имя, логин и роль (для преподавателя выберите профиль)");
  if (String(b.password ?? "").length < 6) return bad(res, "Пароль не короче 6 символов");
  await q("INSERT INTO users (name, login, password_hash, role, teacher_id) VALUES (?,?,?,?,?)",
    [text(b.name, 100), text(b.login, 50), await bcrypt.hash(b.password, 10), b.role, b.role === "teacher" ? b.teacher_id : null]);
  await log(req, "user+", text(b.login, 50)); res.json({ ok: true });
}));
app.put("/api/users/:id", auth("admin"), wrap(async (req, res) => {
  const b = req.body;
  if (!userOk(b)) return bad(res, "Заполните имя и роль (для преподавателя выберите профиль)");
  if (b.role !== "admin" && (await onlyAdmin(req.params.id))) return bad(res, "Нельзя убрать права у последнего администратора");
  await q("UPDATE users SET name=?, role=?, teacher_id=? WHERE id=?", [text(b.name, 100), b.role, b.role === "teacher" ? b.teacher_id : null, req.params.id]);
  if (b.password) {
    if (String(b.password).length < 6) return bad(res, "Пароль не короче 6 символов");
    await q("UPDATE users SET password_hash=? WHERE id=?", [await bcrypt.hash(b.password, 10), req.params.id]);
  }
  await log(req, "user~", "id " + req.params.id); res.json({ ok: true });
}));
app.delete("/api/users/:id", auth("admin"), wrap(async (req, res) => {
  if (+req.params.id === req.session.user.id) return bad(res, "Нельзя удалить самого себя");
  if (await onlyAdmin(req.params.id)) return bad(res, "Нельзя удалить последнего администратора");
  await q("DELETE FROM users WHERE id=?", [req.params.id]);
  await log(req, "user-", "id " + req.params.id); res.json({ ok: true });
}));
app.post("/api/password", auth(), wrap(async (req, res) => {
  const [u] = await q("SELECT password_hash FROM users WHERE id=?", [req.session.user.id]);
  if (!(await bcrypt.compare(String(req.body.old ?? ""), u.password_hash))) return bad(res, "Старый пароль неверный");
  if (String(req.body.new ?? "").length < 6) return bad(res, "Новый пароль не короче 6 символов");
  await q("UPDATE users SET password_hash=? WHERE id=?", [await bcrypt.hash(req.body.new, 10), req.session.user.id]);
  await log(req, "password", "смена пароля"); res.json({ ok: true });
}));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Сайт: http://localhost:${port}`));
