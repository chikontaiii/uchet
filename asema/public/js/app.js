// ===== помощники =====
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => Number(n).toLocaleString("ru-RU");
const opts = (list, sel, label = (x) => x.name) =>
  list.map((x) => `<option value="${x.id}" ${String(x.id) === String(sel) ? "selected" : ""}>${esc(label(x))}</option>`).join("");
const sopts = (list, sel) => list.map((s) => `<option ${s === sel ? "selected" : ""}>${esc(s)}</option>`).join("");

const STATUSES = ["в эксплуатации", "на складе", "на ремонте", "неисправно", "списано"];
const REPAIR = ["новая", "принята", "в работе", "ожидает запчасти", "выполнена", "отклонена"];
const COLORS = ["#0f5c5c", "#3b5ba9", "#8a5a2b", "#7a3f8f", "#c0562a", "#4f6b3a"];

let user = null;
let ref = { rooms: [], teachers: [], categories: [] };
const main = $("#main");
document.documentElement.dataset.theme = localStorage.getItem("theme") || "";

function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (bad ? " bad" : "");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = ""), 2600);
}

async function api(path, method = "GET", body) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "/login") { showLogin(); throw new Error("401"); }
  if (!r.ok) { if (path !== "/login") toast(data.error || "Ошибка", true); throw new Error(data.error || "Ошибка"); }
  return data;
}

// Диалог с формой: возвращает введённые значения или null при отмене
function ask(title, fields, v = {}) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    const input = (f) => f.options
      ? `<select name="${f.name}">${f.options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(v[f.name] ?? "") ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select>`
      : `<input name="${f.name}" type="${f.type || "text"}" ${f.type === "number" ? 'min="0" step="any"' : ""} value="${esc(v[f.name])}" ${f.req ? "required" : ""}>`;
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>
      ${fields.map((f) => `<label>${esc(f.label)}${input(f)}</label>`).join("")}
      <div class="actions"><button value="cancel" formnovalidate>Отмена</button><button class="primary" value="ok">Сохранить</button></div></form>`;
    document.body.append(d);
    d.showModal();
    d.addEventListener("close", () => {
      const data = d.returnValue === "ok" ? Object.fromEntries(new FormData($("form", d))) : null;
      d.remove();
      resolve(data);
    });
  });
}

function info(title, html) {
  const d = document.createElement("dialog");
  d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${html}<div class="actions"><button class="primary">Закрыть</button></div></form>`;
  document.body.append(d);
  d.showModal();
  d.addEventListener("close", () => d.remove());
}

// ===== вход и маршруты =====
const PAGES = [
  { id: "", label: "Главная", icon: "🏠", roles: ["admin", "technician"], run: pageDashboard },
  { id: "assets", label: "Имущество", icon: "📦", roles: ["admin", "teacher"], run: pageAssets },
  { id: "rooms", label: "Кабинеты", icon: "🚪", roles: ["admin"], run: pageRooms },
  { id: "teachers", label: "Преподаватели", icon: "👩‍🏫", roles: ["admin"], run: pageTeachers },
  { id: "repairs", label: "Ремонт", icon: "🛠️", roles: ["admin", "technician", "teacher"], run: pageRepairs },
  { id: "reports", label: "Отчёты", icon: "📊", roles: ["admin"], run: pageReports },
  { id: "inventory", label: "Инвентаризация", icon: "✅", roles: ["admin"], run: pageInventory },
  { id: "writeoffs", label: "Списание", icon: "🗑️", roles: ["admin"], run: pageWriteoffs },
  { id: "users", label: "Пользователи", icon: "👤", roles: ["admin"], run: pageUsers },
  { id: "log", label: "Журнал", icon: "📝", roles: ["admin"], run: pageLog },
];
const ROLE = { admin: "Администратор", technician: "Технический специалист", teacher: "Преподаватель" };
const allowed = () => PAGES.filter((p) => p.roles.includes(user.role));

function showLogin() {
  user = null;
  $("#app").hidden = true;
  $("#login").hidden = false;
}

async function showApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  [ref.rooms, ref.teachers, ref.categories] = await Promise.all([api("/rooms"), api("/teachers"), api("/categories")]);
  $("#nav").innerHTML = allowed().map((p) => `<a href="#/${p.id}" data-id="${p.id}"><span>${p.icon}</span>${p.label}</a>`).join("");
  $("#who").innerHTML = `<b>${esc(user.name)}</b><small>${ROLE[user.role]}</small><button id="pwd">Сменить пароль</button><button id="theme">Светлая / тёмная тема</button><button id="logout">Выйти</button>`;
  route();
}

function route() {
  if (!user) return;
  const id = location.hash.replace(/^#\//, "");
  const page = allowed().find((p) => p.id === id) || allowed()[0];
  if (location.hash !== "#/" + page.id) { location.hash = "#/" + page.id; return; }
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.id === page.id));
  page.run();
}
window.addEventListener("hashchange", route);

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginError").textContent = "";
  try {
    user = await api("/login", "POST", Object.fromEntries(new FormData(e.target)));
    e.target.reset();
    showApp();
  } catch (err) {
    $("#loginError").textContent = err.message;
  }
});
document.addEventListener("click", async (e) => {
  if (e.target.id === "logout") { await api("/logout", "POST"); location.hash = ""; showLogin(); }
  if (e.target.id === "theme") {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  }
  if (e.target.id === "pwd") {
    const v = await ask("Смена пароля", [
      { name: "old", label: "Старый пароль", type: "password", req: 1 },
      { name: "new", label: "Новый пароль (не короче 6 символов)", type: "password", req: 1 },
    ]);
    if (v) { await api("/password", "POST", v); toast("Пароль изменён"); }
  }
});

// ===== главная =====
async function pageDashboard() {
  const d = await api("/dashboard");
  const pct = (n) => (d.count ? (n / d.count) * 100 : 0) + "%";
  const byStatus = (s) => d.byStatus.find((x) => x.status === s)?.n || 0;
  main.innerHTML = `
    <div class="hero"><img src="/img/hero.svg" alt=""><h2>Добро пожаловать, ${esc(user.name)}!</h2></div>
    <ul class="stats">
      <li><b>${d.count}</b>единиц имущества</li>
      <li><b>${money(d.total)}</b>учётная стоимость, сом</li>
      <li><b>${byStatus("в эксплуатации")}</b>в эксплуатации</li>
      <li><b>${d.open}</b>открытых заявок на ремонт</li>
    </ul>
    <div class="two">
      <section class="card"><h3>По статусам</h3>
        ${STATUSES.map((s) => `<div class="bar"><span>${s}</span><i style="width:${pct(byStatus(s))}"></i><b>${byStatus(s)}</b></div>`).join("")}</section>
      <section class="card"><h3>По категориям</h3>
        ${d.byCategory.map((c, i) => `<div class="bar"><span><img class="mini" src="/img/cat-${c.id}.svg" alt="">${esc(c.name)}</span><i style="width:${pct(c.n)};background:${COLORS[i % 6]}"></i><b>${c.n}</b></div>`).join("")}</section>
    </div>
    <section class="card"><h3>Требует внимания</h3><ul class="plain">
      ${d.openList.map((r) => `<li>🛠️ ${esc(r.asset)} — ${esc(r.description)} (${esc(r.status)})</li>`).join("")}
      ${d.noTeacher ? `<li>🚪 Кабинетов без ответственного преподавателя: ${d.noTeacher}</li>` : ""}
      ${!d.openList.length && !d.noTeacher ? "<li>Всё в порядке</li>" : ""}
    </ul></section>`;
}

// ===== имущество =====
const assetFields = (withRoom) => [
  { name: "inventory_no", label: "Инв. номер", req: 1 },
  { name: "name", label: "Название", req: 1 },
  { name: "category_id", label: "Категория", options: ref.categories.map((c) => ({ v: c.id, t: c.name })) },
  ...(withRoom ? [{ name: "room_id", label: "Кабинет", options: ref.rooms.map((r) => ({ v: r.id, t: `${r.number} — ${r.name}` })) }] : []),
  { name: "cost", label: "Стоимость, сом", type: "number", req: 1 },
];

async function pageAssets() {
  const admin = user.role === "admin";
  let page = 1, rows = [];
  main.innerHTML = `<h2>Имущество</h2>
    <div class="toolbar">
      <input id="q" placeholder="Поиск по названию или номеру">
      <select id="cat"><option value="">Все категории</option>${opts(ref.categories)}</select>
      <select id="st"><option value="">Все статусы</option>${sopts(STATUSES)}</select>
      ${admin ? '<button class="primary" id="add">+ Добавить</button>' : ""}
    </div><div id="list"></div>`;

  async function load() {
    const qs = new URLSearchParams({ q: $("#q").value, status: $("#st").value, categoryId: $("#cat").value, page, limit: 10 });
    const res = await api("/assets?" + qs);
    rows = res.rows;
    const pages = Math.max(1, Math.ceil(res.total / 10));
    $("#list").innerHTML = `<div class="scroll"><table>
      <thead><tr><th>Название</th><th>Инв. номер</th><th>Кабинет</th><th>Ответственный</th><th>Стоимость</th><th>Статус</th><th></th></tr></thead>
      <tbody>${rows.map((a) => `<tr>
        <td class="name"><img class="thumb" src="/img/cat-${a.category_id}.svg" alt="">${esc(a.name)}</td>
        <td>${esc(a.inventory_no)}</td>
        <td>${admin ? `<select data-move="${a.id}">${opts(ref.rooms, a.room_id, (r) => r.number)}</select>` : esc(a.room)}</td>
        <td>${esc(a.teacher || "—")}</td>
        <td>${money(a.cost)}</td>
        <td>${admin ? `<select class="st ${a.status.replace(/ /g, "-")}" data-status="${a.id}">${sopts(STATUSES, a.status)}</select>` : esc(a.status)}</td>
        <td><div class="actions"><button data-hist="${a.id}">История</button><button data-label="${a.id}">Этикетка</button>
          ${admin ? `<button data-edit="${a.id}">Изменить</button><button class="danger" data-del="${a.id}">Удалить</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>
      ${rows.length ? "" : '<p class="hint">Ничего не найдено.</p>'}
      <div class="pager"><button id="prev" ${page === 1 ? "disabled" : ""}>Назад</button>
        <span>Страница ${page} из ${pages} · всего ${res.total}</span>
        <button id="next" ${page >= pages ? "disabled" : ""}>Вперёд</button></div>`;
  }

  let timer;
  $("#q").oninput = () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; load(); }, 250); };
  $("#cat").onchange = $("#st").onchange = () => { page = 1; load(); };
  if (admin) $("#add").onclick = async () => {
    const v = await ask("Добавить имущество", assetFields(true));
    if (v) { await api("/assets", "POST", v); toast("Добавлено"); load(); }
  };
  const list = $("#list");
  list.onchange = async (e) => {
    const t = e.target;
    if (t.dataset.move) { await api(`/assets/${t.dataset.move}/move`, "PATCH", { room_id: t.value }); toast("Перемещено"); load(); }
    if (t.dataset.status) {
      let reason;
      if (t.value === "списано") {
        const v = await ask("Списание имущества", [{ name: "reason", label: "Причина списания", req: 1 }]);
        if (!v) return load();
        reason = v.reason;
      }
      await api(`/assets/${t.dataset.status}/status`, "PATCH", { status: t.value, reason });
      toast("Статус обновлён"); load();
    }
  };
  list.onclick = async (e) => {
    const t = e.target;
    if (t.id === "prev") { page--; load(); }
    if (t.id === "next") { page++; load(); }
    if (t.dataset.label) printLabel(rows.find((x) => x.id == t.dataset.label));
    if (t.dataset.hist) {
      const h = await api(`/assets/${t.dataset.hist}/history`);
      info("История перемещений", `<ul class="plain">${h.map((x) => `<li>${esc(x.date)} — ${esc(x.reason)}, кабинет ${esc(x.room)}</li>`).join("")}</ul>`);
    }
    if (t.dataset.edit) {
      const a = rows.find((x) => x.id == t.dataset.edit);
      const v = await ask("Изменить имущество", assetFields(false), a);
      if (v) { await api(`/assets/${a.id}`, "PUT", v); toast("Сохранено"); load(); }
    }
    if (t.dataset.del && confirm("Удалить имущество вместе с историей и заявками?")) {
      await api(`/assets/${t.dataset.del}`, "DELETE"); toast("Удалено"); load();
    }
  };
  load();
}

// ===== кабинеты =====
const teacherOpts = () => [{ v: "", t: "Не назначен" }, ...ref.teachers.map((t) => ({ v: t.id, t: t.name }))];
const roomFields = () => [
  { name: "number", label: "Номер", req: 1 },
  { name: "name", label: "Название", req: 1 },
  { name: "building", label: "Корпус", options: [{ v: "Корпус А", t: "Корпус А" }, { v: "Корпус Б", t: "Корпус Б" }] },
  { name: "floor", label: "Этаж", type: "number" },
  { name: "teacher_id", label: "Ответственный", options: teacherOpts() },
];

async function pageRooms() {
  const [rooms, assets] = await Promise.all([api("/rooms"), api("/assets?limit=1000")]);
  ref.rooms = rooms;
  main.innerHTML = `<h2>Кабинеты</h2><div class="toolbar"><button class="primary" id="add">+ Добавить кабинет</button></div>
    <div class="grid">${rooms.map((r) => `<section class="card">
      <h3>${esc(r.number)} <small>${esc(r.name)}</small></h3>
      <p class="hint">${esc(r.building)}, этаж ${r.floor}</p>
      <p>Ответственный: <b>${esc(r.teacher || "не назначен")}</b></p>
      <p><b>${r.assets}</b> ед. · ${money(r.total)} сом</p>
      <div class="icons">${assets.rows.filter((a) => a.room_id === r.id).slice(0, 8).map((a) => `<img class="mini" src="/img/cat-${a.category_id}.svg" title="${esc(a.name)}" alt="">`).join("")}</div>
      <div class="actions"><button data-edit="${r.id}">Изменить</button><button class="danger" data-del="${r.id}">Удалить</button></div></section>`).join("")}</div>`;
  $("#add").onclick = async () => {
    const v = await ask("Добавить кабинет", roomFields(), { building: "Корпус А", floor: 1 });
    if (v) { await api("/rooms", "POST", v); toast("Добавлено"); showApp(); }
  };
  main.querySelector(".grid").onclick = async (e) => {
    const id = e.target.dataset.edit || e.target.dataset.del;
    if (!id) return;
    if (e.target.dataset.edit) {
      const v = await ask("Изменить кабинет", roomFields(), rooms.find((r) => r.id == id));
      if (v) { await api(`/rooms/${id}`, "PUT", v); toast("Сохранено"); showApp(); }
    } else if (confirm("Удалить кабинет?")) { await api(`/rooms/${id}`, "DELETE"); toast("Удалено"); showApp(); }
  };
}

// ===== преподаватели =====
const teacherFields = [
  { name: "name", label: "ФИО", req: 1 },
  { name: "subject", label: "Предмет" },
  { name: "phone", label: "Телефон" },
];

async function pageTeachers() {
  const teachers = await api("/teachers");
  ref.teachers = teachers;
  main.innerHTML = `<h2>Преподаватели и ответственные</h2><div class="toolbar"><button class="primary" id="add">+ Добавить</button></div>
    <div class="grid">${teachers.map((t) => `<section class="card">
      <div class="avatar" style="background:${COLORS[t.id % 6]}">${esc(t.name.slice(0, 1))}</div>
      <h3>${esc(t.name)}</h3><p class="hint">${esc(t.subject)} · ${esc(t.phone)}</p>
      <p>Кабинеты: ${esc(t.rooms || "—")}</p>
      <p><b>${t.assets}</b> ед. на сумму ${money(t.total)} сом</p>
      <div class="actions"><button data-edit="${t.id}">Изменить</button><button class="danger" data-del="${t.id}">Удалить</button></div></section>`).join("")}</div>`;
  $("#add").onclick = async () => {
    const v = await ask("Добавить преподавателя", teacherFields);
    if (v) { await api("/teachers", "POST", v); toast("Добавлено"); pageTeachers(); }
  };
  main.querySelector(".grid").onclick = async (e) => {
    const id = e.target.dataset.edit || e.target.dataset.del;
    if (!id) return;
    if (e.target.dataset.edit) {
      const v = await ask("Изменить преподавателя", teacherFields, teachers.find((t) => t.id == id));
      if (v) { await api(`/teachers/${id}`, "PUT", v); toast("Сохранено"); pageTeachers(); }
    } else if (confirm("Удалить преподавателя? Его кабинеты останутся без ответственного.")) {
      await api(`/teachers/${id}`, "DELETE"); toast("Удалено"); pageTeachers();
    }
  };
}

// ===== ремонт =====
async function pageRepairs() {
  const canManage = user.role !== "teacher";
  const canCreate = user.role !== "technician";
  const repairs = await api("/repairs");
  main.innerHTML = `<h2>Ремонт</h2>${canCreate ? '<div class="toolbar"><button class="primary" id="add">+ Сообщить о неисправности</button></div>' : ""}
    <div class="scroll"><table><thead><tr><th>Дата</th><th>Имущество</th><th>Кабинет</th><th>Проблема</th><th>Приоритет</th><th>Статус</th></tr></thead>
    <tbody>${repairs.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.asset)}<br><small class="hint">${esc(r.inventory_no)}</small></td><td>${esc(r.room)}</td>
      <td>${esc(r.description)}</td><td>${esc(r.priority)}</td>
      <td>${canManage ? `<select data-id="${r.id}">${sopts(REPAIR, r.status)}</select>` : esc(r.status)}</td></tr>`).join("")}</tbody></table></div>
    ${repairs.length ? "" : '<p class="hint">Заявок пока нет.</p>'}`;
  main.querySelector("tbody").onchange = async (e) => {
    await api(`/repairs/${e.target.dataset.id}/status`, "PATCH", { status: e.target.value });
    toast("Статус обновлён"); pageRepairs();
  };
  if (canCreate) $("#add").onclick = async () => {
    const { rows } = await api("/assets?limit=1000");
    const v = await ask("Заявка на ремонт", [
      { name: "asset_id", label: "Имущество", options: rows.map((a) => ({ v: a.id, t: `${a.inventory_no} — ${a.name}` })) },
      { name: "description", label: "Что случилось?", req: 1 },
      { name: "priority", label: "Приоритет", options: ["низкий", "средний", "высокий"].map((p) => ({ v: p, t: p })) },
    ], { priority: "средний" });
    if (v) { await api("/repairs", "POST", v); toast("Заявка отправлена"); pageRepairs(); }
  };
}

// ===== отчёты =====
async function pageReports() {
  main.innerHTML = `<h2>Отчёты</h2><div class="toolbar">
    <select id="room"><option value="">Все кабинеты</option>${opts(ref.rooms, "", (r) => r.number)}</select>
    <select id="st"><option value="">Все статусы</option>${sopts(STATUSES)}</select>
    <button class="primary" id="csv">Скачать для Excel</button><button id="print">Печать</button></div><div id="list"></div>`;
  let rows = [];
  async function load() {
    const qs = new URLSearchParams({ roomId: $("#room").value, status: $("#st").value, limit: 10000 });
    rows = (await api("/assets?" + qs)).rows;
    $("#list").innerHTML = `<div class="scroll"><table><thead><tr><th>Инв. номер</th><th>Название</th><th>Кабинет</th><th>Ответственный</th><th>Статус</th><th>Стоимость</th></tr></thead>
      <tbody>${rows.map((a) => `<tr><td>${esc(a.inventory_no)}</td><td>${esc(a.name)}</td><td>${esc(a.room)}</td><td>${esc(a.teacher || "—")}</td><td>${esc(a.status)}</td><td>${money(a.cost)}</td></tr>`).join("")}</tbody></table></div>
      <p>Всего: ${rows.length} ед., на сумму ${money(rows.reduce((s, a) => s + a.cost, 0))} сом</p>`;
  }
  $("#room").onchange = $("#st").onchange = load;
  $("#print").onclick = () => window.print();
  $("#csv").onclick = () => {
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((a) => [a.inventory_no, a.name, a.room, a.teacher, a.status, a.cost].map(cell).join(";"));
    const text = "\uFEFF" + ["Инв. номер;Название;Кабинет;Ответственный;Статус;Стоимость", ...lines].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    link.download = "report.csv";
    link.click();
  };
  load();
}

// ===== журнал действий =====
async function pageLog() {
  const log = await api("/log");
  main.innerHTML = `<h2>Журнал действий</h2><div class="scroll"><table><thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Подробности</th></tr></thead>
    <tbody>${log.map((l) => `<tr><td>${esc(l.created_at)}</td><td>${esc(l.user_name)}</td><td>${esc(l.action)}</td><td>${esc(l.details)}</td></tr>`).join("")}</tbody></table></div>
    ${log.length ? "" : '<p class="hint">Записей пока нет.</p>'}`;
}

// ===== печать =====
function printPage(title, body, delay = 300) {
  const w = window.open("", "_blank");
  if (!w) return toast("Разрешите всплывающие окна для печати", true);
  w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font-family:"Segoe UI",sans-serif;padding:24px;color:#000}table{border-collapse:collapse;width:100%}th,td{border:1px solid #000;padding:6px;text-align:left}.sign{margin-top:48px;display:flex;justify-content:space-between}</style></head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), delay);
}

function printLabel(a) {
  // QR-код рисуется библиотекой с cdnjs (нужен интернет); без неё напечатается только текст
  const code = JSON.stringify(a.inventory_no).replace(/</g, "\\u003c");
  printPage("Этикетка " + a.inventory_no, `<div style="border:2px solid #000;padding:12px;width:300px;text-align:center">
    <div id="qr" style="display:flex;justify-content:center"></div>
    <h2 style="margin:8px 0 0">${esc(a.inventory_no)}</h2><div>${esc(a.name)}</div><small>Кабинет ${esc(a.room)}</small></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <script>try { new QRCode(document.getElementById("qr"), { text: ${code}, width: 120, height: 120 }); } catch (e) {}<\/script>`, 1500);
}

// ===== инвентаризация =====
const RESULTS = ["не проверено", "найдено", "не найдено", "повреждено"];

async function pageInventory() {
  const checks = await api("/inventory");
  main.innerHTML = `<h2>Инвентаризация</h2><div class="toolbar"><button class="primary" id="add">+ Начать инвентаризацию</button></div>
    <div class="scroll"><table><thead><tr><th>№</th><th>Кабинет</th><th>Начата</th><th>Проверено</th><th>Не найдено</th><th>Повреждено</th><th>Статус</th><th></th></tr></thead>
    <tbody>${checks.map((c) => `<tr><td>${c.id}</td><td>${esc(c.room)}</td><td>${esc(c.started_at)}</td><td>${c.found + c.missing + c.damaged} из ${c.total}</td>
      <td>${c.missing}</td><td>${c.damaged}</td><td>${esc(c.status)}</td><td><button data-open="${c.id}">Открыть</button></td></tr>`).join("")}</tbody></table></div>
    ${checks.length ? "" : '<p class="hint">Инвентаризаций пока нет.</p>'}`;
  $("#add").onclick = async () => {
    const v = await ask("Выберите кабинет для проверки", [{ name: "room_id", label: "Кабинет", options: ref.rooms.map((r) => ({ v: r.id, t: `${r.number} — ${r.name}` })) }]);
    if (v) openCheck((await api("/inventory", "POST", v)).id);
  };
  main.querySelector("tbody").onclick = (e) => e.target.dataset.open && openCheck(e.target.dataset.open);
}

async function openCheck(id) {
  const c = await api("/inventory/" + id);
  const open = c.status === "открыта";
  const done = c.items.filter((i) => i.result !== "не проверено").length;
  main.innerHTML = `<h2>Инвентаризация № ${c.id}, кабинет ${esc(c.room)}</h2>
    <p class="hint">${esc(c.status)} · проверено ${done} из ${c.items.length}</p>
    <div class="toolbar"><button id="back">← К списку</button><button id="print">Печать акта</button>${open ? '<button class="primary" id="close">Закрыть инвентаризацию</button>' : ""}</div>
    <div class="scroll"><table><thead><tr><th>Имущество</th><th>Инв. номер</th><th>Результат</th></tr></thead>
    <tbody>${c.items.map((i) => `<tr><td class="name"><img class="thumb" src="/img/cat-${i.category_id}.svg" alt="">${esc(i.name)}</td><td>${esc(i.inventory_no)}</td>
      <td>${open ? `<select data-item="${i.id}">${sopts(RESULTS, i.result)}</select>` : esc(i.result)}</td></tr>`).join("")}</tbody></table></div>`;
  $("#back").onclick = pageInventory;
  $("#print").onclick = () => printPage("Акт инвентаризации № " + c.id, `<h2>Акт инвентаризации № ${c.id}</h2><p>Кабинет ${esc(c.room)}. Начата: ${esc(c.started_at)}. Статус: ${esc(c.status)}.</p>
    <table><tr><th>Инв. номер</th><th>Название</th><th>Результат</th></tr>${c.items.map((i) => `<tr><td>${esc(i.inventory_no)}</td><td>${esc(i.name)}</td><td>${esc(i.result)}</td></tr>`).join("")}</table>
    <div class="sign"><span>Проверил: ____________</span><span>Ответственный: ____________</span></div>`);
  if (open) {
    main.querySelector("tbody").onchange = async (e) => { await api(`/inventory/items/${e.target.dataset.item}`, "PATCH", { result: e.target.value }); openCheck(id); };
    $("#close").onclick = async () => {
      if (done < c.items.length && !confirm("Не все позиции проверены. Всё равно закрыть?")) return;
      await api(`/inventory/${id}/close`, "POST"); toast("Инвентаризация закрыта"); openCheck(id);
    };
  }
}

// ===== списание =====
async function pageWriteoffs() {
  const list = await api("/writeoffs");
  main.innerHTML = `<h2>Списание</h2><p class="hint">Чтобы списать имущество, выберите статус «списано» на странице «Имущество».</p>
    <div class="scroll"><table><thead><tr><th>Дата</th><th>Имущество</th><th>Инв. номер</th><th>Стоимость</th><th>Причина</th><th>Кто списал</th><th></th></tr></thead>
    <tbody>${list.map((w) => `<tr><td>${esc(w.date)}</td><td>${esc(w.asset)}</td><td>${esc(w.inventory_no)}</td><td>${money(w.cost)}</td><td>${esc(w.reason)}</td><td>${esc(w.created_by)}</td>
      <td><button data-act="${w.id}">Акт</button></td></tr>`).join("")}</tbody></table></div>
    ${list.length ? "" : '<p class="hint">Списанного имущества пока нет.</p>'}`;
  main.querySelector("tbody").onclick = (e) => {
    const w = list.find((x) => x.id == e.target.dataset.act);
    if (w) printPage("Акт списания " + w.id, `<h2>Акт списания № ${w.id}</h2><p>Дата: ${esc(w.date)}</p>
      <table><tr><th>Инв. номер</th><th>Название</th><th>Стоимость, сом</th><th>Причина</th></tr>
      <tr><td>${esc(w.inventory_no)}</td><td>${esc(w.asset)}</td><td>${money(w.cost)}</td><td>${esc(w.reason)}</td></tr></table>
      <div class="sign"><span>Комиссия: ____________</span><span>Руководитель: ____________</span></div>`);
  };
}

// ===== пользователи =====
async function pageUsers() {
  const users = await api("/users");
  const fields = (isNew) => [
    { name: "name", label: "Имя", req: 1 },
    ...(isNew ? [{ name: "login", label: "Логин", req: 1 }] : []),
    { name: "password", label: isNew ? "Пароль (не короче 6 символов)" : "Новый пароль (пусто — не менять)", type: "password", req: isNew },
    { name: "role", label: "Роль", options: Object.entries(ROLE).map(([v, t]) => ({ v, t })) },
    { name: "teacher_id", label: "Профиль преподавателя (для роли «Преподаватель»)", options: teacherOpts() },
  ];
  main.innerHTML = `<h2>Пользователи</h2><div class="toolbar"><button class="primary" id="add">+ Добавить пользователя</button></div>
    <div class="scroll"><table><thead><tr><th>Имя</th><th>Логин</th><th>Роль</th><th>Профиль преподавателя</th><th></th></tr></thead>
    <tbody>${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.login)}</td><td>${ROLE[u.role]}</td><td>${esc(u.teacher || "—")}</td>
      <td><div class="actions"><button data-edit="${u.id}">Изменить</button><button class="danger" data-del="${u.id}">Удалить</button></div></td></tr>`).join("")}</tbody></table></div>`;
  $("#add").onclick = async () => {
    const v = await ask("Новый пользователь", fields(true), { role: "teacher" });
    if (v) { await api("/users", "POST", v); toast("Пользователь добавлен"); pageUsers(); }
  };
  main.querySelector("tbody").onclick = async (e) => {
    const id = e.target.dataset.edit || e.target.dataset.del;
    if (!id) return;
    if (e.target.dataset.edit) {
      const v = await ask("Изменить пользователя", fields(false), users.find((u) => u.id == id));
      if (v) { await api(`/users/${id}`, "PUT", v); toast("Сохранено"); pageUsers(); }
    } else if (confirm("Удалить пользователя?")) { await api(`/users/${id}`, "DELETE"); toast("Удалено"); pageUsers(); }
  };
}

// ===== старт =====
(async () => {
  try { user = await api("/me"); showApp(); } catch { showLogin(); }
})();
