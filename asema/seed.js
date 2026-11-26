// Создаёт таблицы и заполняет их тестовыми данными: npm run db:setup
// Внимание: старые данные в этих таблицах удаляются.
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";
import { dbConfig, dbName } from "./db-config.js";
import bcrypt from "bcryptjs";

const d = JSON.parse(fs.readFileSync("seed-data.json", "utf8"));
const c = await mysql.createConnection({ ...dbConfig, multipleStatements: true });
// На облачных серверах создавать базу часто нельзя — тогда используется уже созданная
try { await c.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4`); } catch {}
await c.query(`USE \`${dbName}\``);

await c.query(fs.readFileSync("schema.sql", "utf8"));
const ins = (table, cols, rows) => c.query(`INSERT INTO ${table} (${cols}) VALUES ?`, [rows]);

await ins("teachers", "id,name,subject,phone", d.teachers.map((t) => [t.id, t.name, t.subject, t.phone]));
await ins("categories", "id,name", d.categories.map((x) => [x.id, x.name]));
await ins("rooms", "id,number,name,building,floor,teacher_id", d.rooms.map((r) => [r.id, r.number, r.name, r.building, r.floor, r.teacherId]));

const users = [...d.users.map((u) => [u.name, u.login, u.password, u.role, null]), ["Бекова А.Т.", "teacher", "1234", "teacher", 1]];
await ins("users", "name,login,password_hash,role,teacher_id", users.map(([n, l, p, r, t]) => [n, l, bcrypt.hashSync(p, 10), r, t]));

await ins("assets", "id,inventory_no,name,category_id,room_id,cost,status", d.assets.map((a) => [a.id, a.inventoryNo, a.name, a.categoryId, a.roomId, a.cost, a.status]));
await ins("assignments", "id,asset_id,room_id,date,reason", d.assignments.map((a) => [a.id, a.assetId, a.roomId, a.date, a.reason]));
if (d.repairs.length) await ins("repairs", "id,asset_id,description,priority,status,created_by,date", d.repairs.map((r) => [r.id, r.assetId, r.description, r.priority, r.status, r.createdBy, r.date]));

console.log("База готова: данные загружены.");
await c.end();
