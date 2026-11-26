// Настройки подключения к MySQL: локальной или облачной.
// Вариант 1: одна строка DATABASE_URL=mysql://user:password@host:port/database
// Вариант 2: отдельные DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
import "dotenv/config";
import fs from "fs";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;

export const dbName = url ? decodeURIComponent(url.pathname.slice(1)) : process.env.DB_NAME || "college_inventory";
export const dbConfig = {
  host: url ? url.hostname : process.env.DB_HOST || "localhost",
  port: (url && +url.port) || +process.env.DB_PORT || 3306,
  user: url ? decodeURIComponent(url.username) : process.env.DB_USER || "root",
  password: url ? decodeURIComponent(url.password) : process.env.DB_PASSWORD || "",
  charset: "utf8mb4",
  // Облачные базы требуют защищённого соединения: DB_SSL=true (и DB_SSL_CA=путь к сертификату, если провайдер его выдаёт)
  ssl: process.env.DB_SSL === "true" || url?.searchParams.has("ssl-mode") || url?.searchParams.has("ssl")
    ? { rejectUnauthorized: true, ca: process.env.DB_SSL_CA ? fs.readFileSync(process.env.DB_SSL_CA) : undefined }
    : undefined,
};
