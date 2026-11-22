
"use strict";

// =====================================
// LEME PLANNER - VERSÃO EXPANDIDA
// =====================================

const STORAGE_KEY = "leme_planner_v1";
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const pad = n => String(n).padStart(2, "0");

function dateKey(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-");
}

function parseDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(value, amount) {
  const d = parseDate(value);
  d.setDate(d.getDate() + amount);
  return dateKey(d);
}

function formatDate(value) {
  if (!value) return "Sem prazo";
  const d = parseDate(value);
  return d && !isNaN(d.getTime())
    ? d.toLocaleDateString("pt-BR")
    : "Data inválida";
}

function uid() {
  if (typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value) || 0);
}

function pct(part, total) {
  return total ? Math.round(part / total * 100) : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function empty(message) {
  return `<div class="empty">${esc(message)}</div>`;
}

function blankData() {
  return {
    tasks: [],
    goals: [],
    habits: [],
    projects: [],
    focusSessions: [],
    transactions: [],
    savingGoals: [],
    studies: [],
    studySessions: [],
    agenda: [],
    settings: { name: "", theme: "light" }
  };
}

function normalizeData(value) {
  const base = blankData();

  if (!value || typeof value !== "object" ||
      Array.isArray(value)) return base;

  for (const key of [
    "tasks", "goals", "habits", "projects",
    "focusSessions", "transactions",
    "savingGoals", "studies", "studySessions", "agenda"
  ]) {
    if (Array.isArray(value[key])) {
      base[key] = value[key].filter(
        item => item && typeof item === "object" &&
          !Array.isArray(item)
      );
    }
  }

  if (value.settings && typeof value.settings === "object") {
    base.settings.name =
      typeof value.settings.name === "string"
        ? value.settings.name : "";
    base.settings.theme =
      value.settings.theme === "dark" ? "dark" : "light";
  }

  return base;
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeData(JSON.parse(raw)) : blankData();
  } catch (error) {
    console.error("Erro ao carregar:", error);
    return blankData();
  }
}

let db = loadData();

function saveData() {
  try {
    // O Leme One original continua intacto: a sincronizacao atua apenas ao entrar.
    // Dados antigos permanecem disponiveis para migracao ou backup.
    if (window.LemeCloud && window.LemeCloud.isActive()) {
      if (!window.LemeCloud.saveChange(db)) {
        throw new Error("Nao foi possivel salvar a copia local da nuvem.");
      }
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    }
    return true;
  } catch (error) {
    console.error(error);
    toast("Erro ao salvar os dados.");
    return false;
  }
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");

  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.classList.remove("show");
  }, 3000);
}

function project(id) {
  return db.projects.find(p => p.id === id);
}

// =====================================
// NAVEGAÇÃO
// =====================================

const pageInfo = {
  dashboard: ["Visão geral", "Organize seu dia e acompanhe seu progresso."],
  tasks: ["Minhas tarefas", "Tudo o que você precisa fazer."],
  calendar: ["Calendário", "Planeje seus próximos dias."],
  agenda: ["Agenda diária", "Organize sua rotina por horário."],
  goals: ["Metas", "Acompanhe seus objetivos."],
  habits: ["Hábitos", "Construa sua consistência."],
  projects: ["Projetos", "Organize suas áreas de trabalho."],
  finance: ["Financeiro", "Controle suas receitas e despesas."],
  studies: ["Estudos", "Acompanhe seu aprendizado."],
  focus: ["Modo foco", "Concentre-se no que importa."],
  stats: ["Estatísticas", "Acompanhe seus resultados."],
  settings: ["Configurações", "Personalize seu Planner."]
};

function navigate(page) {
  if (!pageInfo[page]) return;

  $$(".page").forEach(el => {
    el.classList.toggle("active", el.id === page);
  });

  $$(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });

  $("#pageTitle").textContent = pageInfo[page][0];
  $("#pageSubtitle").textContent = pageInfo[page][1];
  $("#sidebar").classList.remove("open");

  renderAll();
  window.scrollTo(0, 0);
}

$$(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.page));
});

$$("[data-go]").forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.go));
});

$("#menuToggle").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

document.addEventListener("click", event => {
  if (
    window.innerWidth <= 850 &&
    $("#sidebar").classList.contains("open") &&
    !$("#sidebar").contains(event.target) &&
    !$("#menuToggle").contains(event.target)
  ) {
    $("#sidebar").classList.remove("open");
  }
});

// =====================================
// MODAIS
// =====================================

let modalType = "";
let editingId = null;

const collections = {
  task: "tasks",
  goal: "goals",
  habit: "habits",
  project: "projects",
  transaction: "transactions",
  saving: "savingGoals",
  study: "studies",
  agenda: "agenda"
};

function field(label, name, type = "text", value = "", required = false) {
  return `
    <div class="form-group">
      <label for="field_${name}">${label}</label>
      <input
        id="field_${name}"
        name="${name}"
        type="${type}"
        value="${esc(value)}"
        ${required ? "required" : ""}
      >
    </div>
  `;
}

function textareaField(label, name, value = "") {
  return `
    <div class="form-group">
      <label for="field_${name}">${label}</label>
      <textarea id="field_${name}" name="${name}">${esc(value)}</textarea>
    </div>
  `;
}

function selectField(label, name, options, selected = "") {
  return `
    <div class="form-group">
      <label for="field_${name}">${label}</label>
      <select id="field_${name}" name="${name}">
        ${options.map(([value, text]) => `
          <option value="${esc(value)}"
            ${String(value) === String(selected) ? "selected" : ""}>
            ${esc(text)}
          </option>
        `).join("")}
      </select>
    </div>
  `;
}

function openModal(type, id = null, preset = {}) {
  const collection = collections[type];
  if (!collection) return;

  modalType = type;
  editingId = id;

  const existing = id
    ? db[collection].find(item => item.id === id)
    : null;

  const item = existing || preset;

  const labels = {
    task: "tarefa",
    goal: "meta",
    habit: "hábito",
    project: "projeto",
    transaction: "lançamento financeiro",
    saving: "meta de economia",
    study: "assunto de estudo",
    agenda: "compromisso"
  };

  $("#modalTitle").textContent =
    `${existing ? "Editar" : "Adicionar"} ${labels[type]}`;

  let html = "";


if (type === "task") {
  html += field(
    "Nome da tarefa",
    "title",
    "text",
    item.title || "",
    true
  );

  html += textareaField(
    "Descrição detalhada",
    "description",
    item.description
  );

  html += `<div class="form-row">`;

  html += field(
    "Data",
    "date",
    "date",
    item.date || dateKey(),
    true
  );

  html += field(
    "Horário",
    "time",
    "time",
    item.time || ""
  );

  html += `</div>`;

  html += `<div class="form-row">`;

  html += selectField("Prioridade", "priority", [
    ["low", "Baixa"],
    ["medium", "Média"],
    ["high", "Alta"]
  ], item.priority || "medium");

  html += field(
    "Categoria",
    "category",
    "text",
    item.category || ""
  );

  html += `</div>`;

  html += `<div class="form-row">`;

  html += field(
    "Local / ambiente",
    "location",
    "text",
    item.location || ""
  );

  html += field(
    "Tempo estimado (minutos)",
    "estimatedMinutes",
    "number",
    item.estimatedMinutes || ""
  );

  html += `</div>`;

  html += selectField(
    "Projeto relacionado",
    "projectId",
    [
      ["", "Sem projeto"],
      ...db.projects.map(p => [p.id, p.title])
    ],
    item.projectId || ""
  );

  html += field(
    "Link de referência",
    "referenceUrl",
    "url",
    item.referenceUrl || ""
  );

  html += textareaField(
    "Checklist de subtarefas (uma por linha)",
    "checklist",
    (item.checklist || []).map(c => c.title).join("\n")
  );

  html += textareaField(
    "Observações adicionais",
    "notes",
    item.notes || ""
  );
}


  if (type === "goal") {
    html += field("Nome da meta", "title", "text", item.title || "", true);
    html += textareaField("Descrição", "description", item.description);
    html += `<div class="form-row">`;
    html += field("Valor atual", "current", "number", item.current ?? 0, true);
    html += field("Objetivo", "target", "number", item.target ?? 10, true);
    html += `</div>`;
    html += field("Prazo", "deadline", "date", item.deadline || "");
  }

  if (type === "habit" || type === "project") {
    html += field("Nome", "title", "text", item.title || "", true);
    html += textareaField("Descrição", "description", item.description);
  }

  if (type === "transaction") {
    html += selectField("Tipo", "type", [
      ["income", "Entrada / receita"],
      ["expense", "Saída / despesa"]
    ], item.type || "expense");

    html += field("Descrição", "title", "text", item.title || "", true);

    html += `<div class="form-row">`;
    html += field("Valor em reais", "amount", "number", item.amount ?? "", true);
    html += field("Data", "date", "date", item.date || dateKey(), true);
    html += `</div>`;

    html += selectField("Categoria", "category", [
      ["Trabalho", "Trabalho"],
      ["Clientes", "Clientes"],
      ["Salário", "Salário"],
      ["Freelance", "Freelance"],
      ["Alimentação", "Alimentação"],
      ["Transporte", "Transporte"],
      ["Moradia", "Moradia"],
      ["Assinaturas", "Assinaturas"],
      ["Estudos", "Estudos"],
      ["Lazer", "Lazer"],
      ["Saúde", "Saúde"],
      ["Compras", "Compras"],
      ["Investimentos", "Investimentos"],
      ["Outros", "Outros"]
    ], item.category || "Outros");

    html += textareaField("Observações", "description", item.description);
  }

  if (type === "saving") {
    html += field("Nome da meta", "title", "text", item.title || "", true);
    html += `<div class="form-row">`;
    html += field("Valor economizado (R$)", "current", "number", item.current ?? 0, true);
    html += field("Valor desejado (R$)", "target", "number", item.target ?? "", true);
    html += `</div>`;
    html += field("Prazo", "deadline", "date", item.deadline || "");
    html += textareaField("Descrição", "description", item.description);
  }

  if (type === "study") {
    html += field("Nome do assunto", "title", "text", item.title || "", true);

    html += selectField("Tipo", "type", [
      ["subject", "Matéria"],
      ["course", "Curso"],
      ["skill", "Habilidade"]
    ], item.type || "subject");

    html += textareaField("Descrição", "description", item.description);

    html += field(
      "Conteúdos (um por linha)",
      "unused",
      "hidden",
      ""
    );

    html += textareaField(
      "Lista de conteúdos — um por linha",
      "contents",
      (item.contents || []).map(c => c.title).join("\n")
    );

    html += field(
      "Meta de horas de estudo (opcional)",
      "targetHours",
      "number",
      item.targetHours ?? 0
    );
  }

  if (type === "agenda") {
    html += field("Atividade", "title", "text", item.title || "", true);

    html += `<div class="form-row">`;
    html += field("Data", "date", "date", item.date || agendaSelected, true);
    html += field("Horário inicial", "time", "time", item.time || "08:00", true);
    html += `</div>`;

    html += field(
      "Horário final (opcional)",
      "endTime",
      "time",
      item.endTime || ""
    );

    html += textareaField("Observações", "description", item.description);
  }

  $("#modalFields").innerHTML = html;
  $("#modalOverlay").classList.add("open");

  setTimeout(() => {
    $("#modalFields input:not([type=hidden])")?.focus();
  }, 30);
}

function closeModal() {
  $("#modalOverlay").classList.remove("open");
  $("#modalForm").reset();
  modalType = "";
  editingId = null;
}

$("#closeModal").onclick = closeModal;
$("#cancelModal").onclick = closeModal;

$("#modalOverlay").onclick = event => {
  if (event.target.id === "modalOverlay") closeModal();
};

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModal();
});

$("#modalForm").addEventListener("submit", event => {
  event.preventDefault();

  const values = Object.fromEntries(
    new FormData(event.target).entries()
  );

  const title = (values.title || "").trim();
  if (!title) return toast("Informe um nome.");

  const collection = collections[modalType];
  if (!collection) return;

  const existing = editingId
    ? db[collection].find(item => item.id === editingId)
    : null;

  const base = existing || {
    id: uid(),
    createdAt: new Date().toISOString()
  };

  let updated = { ...base, title };


if (modalType === "task") {
  const estimatedMinutes =
    values.estimatedMinutes === ""
      ? 0
      : Number(values.estimatedMinutes);

  if (
    !Number.isFinite(estimatedMinutes) ||
    estimatedMinutes < 0
  ) {
    return toast("Informe um tempo estimado válido.");
  }

  const previousChecklist = existing?.checklist || [];
  const used = new Set();

  const checklist = (values.checklist || "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(title => {
      const found = previousChecklist.find(
        c => c.title === title && !used.has(c.id)
      );

      if (found) {
        used.add(found.id);
        return { ...found };
      }

      return {
        id: uid(),
        title,
        done: false
      };
    });

  Object.assign(updated, {
    description: values.description || "",
    date: values.date || dateKey(),
    time: values.time || "",
    priority: values.priority || "medium",
    projectId: values.projectId || "",
    category: (values.category || "").trim(),
    location: (values.location || "").trim(),
    estimatedMinutes,
    referenceUrl: (values.referenceUrl || "").trim(),
    checklist,
    notes: (values.notes || "").trim(),
    done: existing ? !!existing.done : false,
    completedAt: existing?.completedAt || null
  });
}


  if (modalType === "goal") {
    const current = Number(values.current);
    const target = Number(values.target);

    if (current < 0 || !Number.isFinite(current) ||
        target <= 0 || !Number.isFinite(target)) {
      return toast("Informe valores válidos.");
    }

    Object.assign(updated, {
      description: values.description || "",
      current,
      target,
      deadline: values.deadline || ""
    });
  }

  if (modalType === "habit") {
    Object.assign(updated, {
      description: values.description || "",
      history: existing?.history || []
    });
  }

  if (modalType === "project") {
    updated.description = values.description || "";
  }

  if (modalType === "transaction") {
    const amount = Number(values.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return toast("O valor precisa ser maior que zero.");
    }

    Object.assign(updated, {
      type: values.type,
      amount: Math.round(amount * 100) / 100,
      date: values.date,
      category: values.category || "Outros",
      description: values.description || ""
    });
  }

  if (modalType === "saving") {
    const current = Number(values.current);
    const target = Number(values.target);

    if (!Number.isFinite(current) || current < 0 ||
        !Number.isFinite(target) || target <= 0) {
      return toast("Informe valores válidos.");
    }

    Object.assign(updated, {
      current: Math.round(current * 100) / 100,
      target: Math.round(target * 100) / 100,
      deadline: values.deadline || "",
      description: values.description || ""
    });
  }

  if (modalType === "study") {
    const previous = existing?.contents || [];

    const lines = (values.contents || "")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);

    const used = new Set();

    const contents = lines.map(line => {
      const found = previous.find(c =>
        c.title === line && !used.has(c.id)
      );

      if (found) {
        used.add(found.id);
        return { ...found };
      }

      return { id: uid(), title: line, done: false };
    });

    Object.assign(updated, {
      type: values.type || "subject",
      description: values.description || "",
      contents,
      targetHours: Math.max(0, Number(values.targetHours) || 0)
    });
  }

  if (modalType === "agenda") {
    if (values.endTime && values.endTime <= values.time) {
      return toast("O horário final precisa ser posterior ao inicial.");
    }

    Object.assign(updated, {
      date: values.date,
      time: values.time,
      endTime: values.endTime || "",
      description: values.description || "",
      done: existing ? !!existing.done : false
    });
  }

  if (existing) {
    const index = db[collection].findIndex(
      item => item.id === editingId
    );
    db[collection][index] = updated;
  } else {
    db[collection].push(updated);
  }

  saveData();
  closeModal();
  renderAll();
  toast(existing ? "Atualizado com sucesso!" : "Adicionado com sucesso!");
});

// =====================================
// TAREFAS ORIGINAIS
// =====================================

function priorityLabel(value) {
  return {
    high: "Alta prioridade",
    medium: "Média prioridade",
    low: "Baixa prioridade"
  }[value] || "Média prioridade";
}


function taskHTML(task) {
  const p = project(task.projectId);
  const checklist = Array.isArray(task.checklist)
    ? task.checklist : [];

  const safeUrl = (() => {
    try {
      const url = new URL(task.referenceUrl || "");
      return ["https:", "http:"].includes(url.protocol)
        ? url.href : "";
    } catch {
      return "";
    }
  })();

  return `
    <div class="task-item ${task.done ? "completed" : ""}">
      <input type="checkbox" class="task-check"
        data-action="toggle-task"
        data-id="${esc(task.id)}"
        ${task.done ? "checked" : ""}
        aria-label="Concluir tarefa">

      <div class="task-info">
        <div class="task-title">${esc(task.title)}</div>

        ${task.description ? `
          <p class="muted" style="font-size:12px;margin:6px 0">
            ${esc(task.description)}
          </p>
        ` : ""}

        <div class="task-meta">
          <span class="tag">${formatDate(task.date)}</span>
          ${task.time ? `<span class="tag">${esc(task.time)}</span>` : ""}
          <span class="tag ${task.priority === "high" ? "high" : ""}">
            ${priorityLabel(task.priority)}
          </span>
          ${p ? `<span class="tag">${esc(p.title)}</span>` : ""}
          ${task.category ? `
            <span class="tag">${esc(task.category)}</span>
          ` : ""}
          ${task.estimatedMinutes ? `
            <span class="tag">◷ ${esc(task.estimatedMinutes)} min</span>
          ` : ""}
        </div>

        ${task.location ? `
          <div class="task-extra">
            Local: ${esc(task.location)}
          </div>
        ` : ""}

        ${task.notes ? `
          <div class="task-extra">
            Observações: ${esc(task.notes)}
          </div>
        ` : ""}

        ${safeUrl ? `
          <div class="task-extra">
            <a href="${esc(safeUrl)}"
              target="_blank"
              rel="noopener noreferrer">
              Abrir link de referência
            </a>
          </div>
        ` : ""}

        ${checklist.length ? `
          <div class="task-checklist">
            ${checklist.map(c => `
              <label class="task-checklist-item
                ${c.done ? "done" : ""}">
                <input type="checkbox" class="task-check"
                  data-action="toggle-task-checklist"
                  data-id="${esc(task.id)}"
                  data-content="${esc(c.id)}"
                  ${c.done ? "checked" : ""}>
                <span>${esc(c.title)}</span>
              </label>
            `).join("")}
          </div>
        ` : ""}
      </div>

      <div class="task-actions">
        <button class="small-btn" data-action="edit-task"
          data-id="${esc(task.id)}" title="Editar">✎</button>
        <button class="small-btn" data-action="delete-task"
          data-id="${esc(task.id)}" title="Excluir">✕</button>
      </div>
    </div>
  `;
}


function toggleTask(id) {
  const task = db.tasks.find(t => t.id === id);
  if (!task) return;

  task.done = !task.done;
  task.completedAt = task.done
    ? new Date().toISOString()
    : null;

  saveData();
  renderAll();
  toast(task.done ? "Tarefa concluída!" : "Tarefa reaberta.");
}


function renderTasks() {
  const search = $("#taskSearch").value.toLowerCase().trim();
  const filter = $("#taskFilter").value;
  const priority = $("#taskPriorityFilter").value;
  const sort = $("#taskSort").value;

  let tasks = db.tasks.filter(t => {
    const searchable = [
      t.title,
      t.description,
      t.category,
      t.location,
      t.notes,
      ...(t.checklist || []).map(c => c.title)
    ].join(" ").toLowerCase();

    return searchable.includes(search);
  });

  // FILTRO POR SITUAÇÃO
  if (filter === "today") {
    tasks = tasks.filter(t => t.date === dateKey());
  }

  if (filter === "pending") {
    tasks = tasks.filter(t => !t.done);
  }

  if (filter === "done") {
    tasks = tasks.filter(t => t.done);
  }

  if (filter === "overdue") {
    tasks = tasks.filter(t =>
      !t.done && t.date && t.date < dateKey()
    );
  }

  if (filter === "selected") {
    tasks = tasks.filter(t => t.date === selectedDate);
  }

  // FILTRO POR PRIORIDADE
  if (priority !== "all") {
    tasks = tasks.filter(t => t.priority === priority);
  }

  // ORDENAÇÃO
  const priorityOrder = {
    high: 0,
    medium: 1,
    low: 2
  };

  tasks.sort((a, b) => {
    if (sort === "priority") {
      return (priorityOrder[a.priority] ?? 1) -
        (priorityOrder[b.priority] ?? 1);
    }

    if (sort === "newest") {
      return (b.createdAt || "").localeCompare(
        a.createdAt || ""
      );
    }

    return (a.date || "").localeCompare(b.date || "") ||
      (a.time || "").localeCompare(b.time || "");
  });

  $("#taskCount").textContent = `${tasks.length} tarefas`;

  $("#taskList").innerHTML = tasks.length
    ? tasks.map(taskHTML).join("")
    : empty("Nenhuma tarefa encontrada para estes filtros.");
}


$("#taskSearch").addEventListener("input", renderTasks);
$("#taskFilter").addEventListener("change", renderTasks);
$("#taskPriorityFilter").addEventListener("change", renderTasks);
$("#taskSort").addEventListener("change", renderTasks);

// =====================================
// DASHBOARD
// =====================================

function renderGreeting() {
  const now = new Date();
  const hour = now.getHours();

  const greeting = hour < 12
    ? "Bom dia"
    : hour < 18 ? "Boa tarde" : "Boa noite";

  const name = db.settings.name.trim();

  $("#greeting").textContent =
    `${greeting}${name ? ", " + name : ""}!`;

  $("#welcomeDate").textContent = pad(now.getDate());

  $("#todayLabel").textContent =
    now.toLocaleDateString("pt-BR", {
      day: "numeric", month: "short", year: "numeric"
    });

  $("#sidebarDate").textContent =
    now.toLocaleDateString("pt-BR", { dateStyle: "full" });
}

function renderDashboard() {
  const today = dateKey();
  const tasks = db.tasks.filter(t => t.date === today);
  const done = tasks.filter(t => t.done).length;

  const overdue = db.tasks.filter(t =>
    !t.done && t.date && t.date < today
  ).length;

  const activeGoals = db.goals.filter(g =>
    Number(g.current) < Number(g.target)
  ).length;

  $("#statToday").textContent = tasks.length;
  $("#statDone").textContent = done;
  $("#statOverdue").textContent = overdue;
  $("#statGoals").textContent = activeGoals;

  const percent = pct(done, tasks.length);

  $("#dailyPercent").textContent = `${percent}%`;
  $("#dailyCircle").style.background =
    `conic-gradient(var(--primary) ${percent}%,var(--border) ${percent}%)`;

  $("#dailyMessage").textContent = !tasks.length
    ? "Adicione suas primeiras tarefas."
    : percent === 100
      ? "Todas as tarefas de hoje foram concluídas!"
      : `${done} de ${tasks.length} tarefas concluídas.`;

  $("#dashboardTasks").innerHTML = tasks.length
    ? [...tasks]
        .sort((a, b) => Number(a.done) - Number(b.done))
        .slice(0, 6)
        .map(taskHTML).join("")
    : empty("Nenhuma tarefa para hoje.");

  $("#dashboardGoals").innerHTML = db.goals.length
    ? db.goals.slice(0, 4).map(g => {
        const percent = clamp(pct(g.current, g.target));
        return `
          <div style="margin-bottom:20px">
            <div class="progress-label">
              <strong>${esc(g.title)}</strong><span>${percent}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${percent}%"></div>
            </div>
          </div>
        `;
      }).join("")
    : empty("Nenhuma meta cadastrada.");

  $("#dashboardHabits").innerHTML = db.habits.length
    ? db.habits.slice(0, 5).map(h => `
        <div class="task-item">
          <input type="checkbox" class="task-check"
            data-action="toggle-habit" data-id="${esc(h.id)}"
            ${(h.history || []).includes(today) ? "checked" : ""}>
          <div class="task-info">
            <div class="task-title">${esc(h.title)}</div>
          </div>
        </div>
      `).join("")
    : empty("Nenhum hábito cadastrado.");

  const agendaItems = db.agenda
    .filter(a => a.date === today)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  $("#dashboardAgenda").innerHTML = agendaItems.length
    ? agendaItems.slice(0, 5).map(a => `
        <div class="transaction-row">
          <div class="transaction-icon">◷</div>
          <div class="transaction-info">
            <strong>${esc(a.title)}</strong>
            <small>${esc(a.time)}${a.endTime ? " – " + esc(a.endTime) : ""}</small>
          </div>
        </div>
      `).join("")
    : empty("Sua agenda de hoje está livre.");

  const month = today.slice(0, 7);
  const monthly = db.transactions.filter(t =>
    (t.date || "").startsWith(month)
  );

  const income = monthly
    .filter(t => t.type === "income")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const expense = monthly
    .filter(t => t.type === "expense")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  $("#dashboardFinance").innerHTML = `
    <div class="focus-stat">
      <span>Entradas</span><strong>${money(income)}</strong>
    </div>
    <div class="focus-stat">
      <span>Despesas</span><strong>${money(expense)}</strong>
    </div>
    <div class="focus-stat">
      <span>Resultado</span>
      <strong class="${income - expense < 0 ? "money-negative" : ""}">
        ${money(income - expense)}
      </strong>
    </div>
  `;
}

// =====================================
// METAS
// =====================================

function renderGoals() {
  $("#goalList").innerHTML = db.goals.length
    ? db.goals.map(g => {
        const percent = clamp(pct(g.current, g.target));

        return `
          <div class="data-card">
            <div class="card-top">
              <h3>${esc(g.title)}</h3>
              <div class="card-actions">
                <button class="small-btn" data-action="edit-goal"
                  data-id="${esc(g.id)}">✎</button>
                <button class="small-btn" data-action="delete-goal"
                  data-id="${esc(g.id)}">✕</button>
              </div>
            </div>

            <p>${esc(g.description || "Sem descrição.")}</p>

            <div class="progress-label">
              <span>${g.current} / ${g.target}</span>
              <strong>${percent}%</strong>
            </div>

            <div class="progress-bar">
              <div class="progress-fill" style="width:${percent}%"></div>
            </div>

            <p>Prazo: ${formatDate(g.deadline)}</p>

            <div class="card-footer">
              <button class="btn" data-action="goal-minus"
                data-id="${esc(g.id)}">− 1</button>
              <button class="btn btn-dark" data-action="goal-plus"
                data-id="${esc(g.id)}">+ 1</button>
            </div>
          </div>
        `;
      }).join("")
    : empty("Crie sua primeira meta.");
}

function changeGoal(id, amount) {
  const goal = db.goals.find(g => g.id === id);
  if (!goal) return;

  goal.current = Math.max(0, Number(goal.current) + amount);
  saveData();
  renderAll();

  if (goal.current >= goal.target) {
    toast("Parabéns! Meta atingida!");
  }
}

// =====================================
// HÁBITOS
// =====================================


// =====================================
// HÁBITOS - CALENDÁRIO DE CONSISTÊNCIA
// =====================================

const habitCalendarMonths = {};

function habitHistory(habit) {
  return Array.isArray(habit.history)
    ? habit.history
    : [];
}

function habitStreak(habit) {
  const history = new Set(habitHistory(habit));
  let day = new Date();
  let count = 0;

  // Se ainda não concluiu hoje, considera ontem
  if (!history.has(dateKey(day))) {
    day.setDate(day.getDate() - 1);
  }

  while (history.has(dateKey(day))) {
    count++;
    day.setDate(day.getDate() - 1);
  }

  return count;
}

function habitLongestStreak(habit) {
  const dates = [...new Set(habitHistory(habit))]
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  let longest = 0;
  let current = 0;
  let previous = null;

  for (const date of dates) {
    if (previous && addDays(previous, 1) === date) {
      current++;
    } else {
      current = 1;
    }

    longest = Math.max(longest, current);
    previous = date;
  }

  return longest;
}

function habitLast30Rate(habit) {
  const history = new Set(habitHistory(habit));
  let completed = 0;

  for (let i = 0; i < 30; i++) {
    const day = addDays(dateKey(), -i);

    if (history.has(day)) completed++;
  }

  return Math.round(completed / 30 * 100);
}

function toggleHabit(id, selectedDay = dateKey()) {
  const habit = db.habits.find(h => h.id === id);
  if (!habit) return;

  if (selectedDay > dateKey()) {
    return toast("Não é possível marcar dias futuros.");
  }

  if (!Array.isArray(habit.history)) {
    habit.history = [];
  }

  if (habit.history.includes(selectedDay)) {
    habit.history = habit.history.filter(
      day => day !== selectedDay
    );
  } else {
    habit.history.push(selectedDay);
  }

  saveData();
  renderAll();

  toast(
    habit.history.includes(selectedDay)
      ? "Hábito marcado como concluído!"
      : "Marcação removida."
  );
}

function habitCalendarHTML(habit) {
  if (!habitCalendarMonths[habit.id]) {
    habitCalendarMonths[habit.id] = dateKey().slice(0, 7);
  }

  const monthKey = habitCalendarMonths[habit.id];
  const [year, month] = monthKey.split("-").map(Number);

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const history = new Set(habitHistory(habit));

  const monthTitle = new Date(year, month - 1, 1)
    .toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric"
    });

  let daysHTML = "";

  // Espaços antes do primeiro dia do mês
  for (let i = 0; i < firstDay; i++) {
    daysHTML += `
      <span class="habit-calendar-day empty-day"></span>
    `;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${pad(month)}-${pad(day)}`;

    const done = history.has(key);
    const today = key === dateKey();
    const future = key > dateKey();

    daysHTML += `
      <button
        class="habit-calendar-day
          ${done ? "done" : ""}
          ${today ? "today" : ""}"
        data-action="habit-calendar-toggle"
        data-id="${esc(habit.id)}"
        data-date="${key}"
        title="${formatDate(key)}${done ? " — concluído" : ""}"
        ${future ? "disabled" : ""}>
        ${done ? "✓" : day}
      </button>
    `;
  }

  return `
    <div class="habit-calendar">
      <div class="habit-calendar-header">
        <strong>${esc(monthTitle)}</strong>

        <div class="habit-calendar-actions">
          <button
            data-action="habit-calendar-prev"
            data-id="${esc(habit.id)}"
            title="Mês anterior">
            ←
          </button>

          <button
            data-action="habit-calendar-next"
            data-id="${esc(habit.id)}"
            title="Próximo mês"
            ${monthKey >= dateKey().slice(0, 7) ? "disabled" : ""}>
            →
          </button>
        </div>
      </div>

      <div class="habit-calendar-weekdays">
        <span>D</span>
        <span>S</span>
        <span>T</span>
        <span>Q</span>
        <span>Q</span>
        <span>S</span>
        <span>S</span>
      </div>

      <div class="habit-calendar-days">
        ${daysHTML}
      </div>

      <p class="habit-calendar-caption">
        Clique em um dia para marcar ou desmarcar.
      </p>
    </div>
  `;
}

function renderHabitHeatmap() {
  const today = dateKey();
  const endDate = parseDate(today);

  // 365 dias, incluindo hoje
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 364);

  // Começa no domingo para alinhar as semanas
  startDate.setDate(
    startDate.getDate() - startDate.getDay()
  );

  const activeDays = new Set();

  db.habits.forEach(habit => {
    habitHistory(habit).forEach(day => {
      if (day <= today) activeDays.add(day);
    });
  });

  const weeks = [];
  const cursor = new Date(startDate);

  while (dateKey(cursor) <= today) {
    const days = [];

    for (let i = 0; i < 7; i++) {
      const key = dateKey(cursor);

      const count = db.habits.filter(h =>
        habitHistory(h).includes(key)
      ).length;

      const total = db.habits.length;

      let level = 0;

      if (count > 0 && total > 0) {
        const ratio = count / total;

        if (ratio <= .25) level = 1;
        else if (ratio <= .5) level = 2;
        else if (ratio <= .75) level = 3;
        else level = 4;
      }

      days.push({
        key,
        count,
        level,
        future: key > today
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    weeks.push(days);
  }

  $("#habitHeatmap").innerHTML = `
    <div class="habit-heatmap">
      ${weeks.map(week => `
        <div class="habit-heatmap-week">
          ${week.map(day => `
            <span
              class="habit-heatmap-cell
                ${day.future ? "future" : "heat-level-" + day.level}"
              title="${formatDate(day.key)} — ${day.count} hábitos concluídos">
            </span>
          `).join("")}
        </div>
      `).join("")}
    </div>
  `;

  const rangeStart = dateKey(startDate);

  const activeInRange = [...activeDays].filter(
    day => day >= rangeStart && day <= today
  ).length;

  $("#habitHeatmapSummary").textContent =
    `${activeInRange} dias com hábitos realizados no período`;
}

function renderHabits() {
  const today = dateKey();

  const completedToday = db.habits.filter(h =>
    habitHistory(h).includes(today)
  ).length;

  const activeLast30 = new Set();

  db.habits.forEach(habit => {
    habitHistory(habit).forEach(day => {
      if (day >= addDays(today, -29) && day <= today) {
        activeLast30.add(day);
      }
    });
  });

  const bestStreak = Math.max(
    0,
    ...db.habits.map(habitLongestStreak)
  );

  $("#habitTotal").textContent = db.habits.length;
  $("#habitDone").textContent = completedToday;
  $("#habitActiveDays").textContent = activeLast30.size;
  $("#habitBestStreak").textContent = bestStreak;

  renderHabitHeatmap();

  $("#habitList").innerHTML = db.habits.length
    ? db.habits.map(habit => {
        const history = habitHistory(habit);
        const done = history.includes(today);

        return `
          <div class="data-card habit-card
            ${done ? "habit-card-completed" : ""}">

            <div class="card-top">
              <div>
                <span class="tag">
                  ${done ? "✓ Concluído hoje" : "Pendente hoje"}
                </span>

                <h3 style="margin-top:12px">
                  ${esc(habit.title)}
                </h3>
              </div>

              <div class="card-actions">
                <button class="small-btn"
                  data-action="edit-habit"
                  data-id="${esc(habit.id)}"
                  title="Editar">✎</button>

                <button class="small-btn"
                  data-action="delete-habit"
                  data-id="${esc(habit.id)}"
                  title="Excluir">✕</button>
              </div>
            </div>

            <p class="habit-card-description">
              ${esc(habit.description || "Seu compromisso diário.")}
            </p>

            <div class="habit-card-stats">
              <div class="habit-mini-stat">
                <strong>${habitStreak(habit)}</strong>
                <span>Sequência atual</span>
              </div>

              <div class="habit-mini-stat">
                <strong>${habitLongestStreak(habit)}</strong>
                <span>Maior sequência</span>
              </div>

              <div class="habit-mini-stat">
                <strong>${history.length}</strong>
                <span>Dias realizados</span>
              </div>

              <div class="habit-mini-stat">
                <strong>${habitLast30Rate(habit)}%</strong>
                <span>Últimos 30 dias</span>
              </div>
            </div>

            ${habitCalendarHTML(habit)}

            <button
              class="btn ${done ? "" : "btn-dark"} habit-complete-btn"
              data-action="toggle-habit"
              data-id="${esc(habit.id)}">
              ${done
                ? "✓ Concluído hoje — desfazer"
                : "Marcar como concluído hoje"}
            </button>
          </div>
        `;
      }).join("")
    : empty("Crie seu primeiro hábito para começar a acompanhar sua evolução.");
}

// =====================================
// PROJETOS
// =====================================

function renderProjects() {
  $("#projectList").innerHTML = db.projects.length
    ? db.projects.map(p => {
        const tasks = db.tasks.filter(t => t.projectId === p.id);
        const done = tasks.filter(t => t.done).length;
        const percent = pct(done, tasks.length);

        return `
          <div class="data-card">
            <div class="card-top">
              <h3>${esc(p.title)}</h3>
              <div class="card-actions">
                <button class="small-btn" data-action="edit-project"
                  data-id="${esc(p.id)}">✎</button>
                <button class="small-btn" data-action="delete-project"
                  data-id="${esc(p.id)}">✕</button>
              </div>
            </div>

            <p>${esc(p.description || "Sem descrição.")}</p>

            <div class="progress-label">
              <span>${done} de ${tasks.length} tarefas</span>
              <strong>${percent}%</strong>
            </div>

            <div class="progress-bar">
              <div class="progress-fill" style="width:${percent}%"></div>
            </div>

            <div class="card-footer">
              <button class="btn btn-dark" data-action="project-task"
                data-id="${esc(p.id)}">+ Adicionar tarefa</button>
            </div>
          </div>
        `;
      }).join("")
    : empty("Crie seus projetos.");
}

// =====================================
// CALENDÁRIO
// =====================================

let calendarDate = new Date();
let selectedDate = dateKey();

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  $("#calendarMonth").textContent =
    calendarDate.toLocaleDateString("pt-BR", {
      month: "long", year: "numeric"
    });

  const firstDay = new Date(year, month, 1).getDay();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((firstDay + lastDay) / 7) * 7;

  let html = "";

  for (let i = 0; i < cells; i++) {
    const date = new Date(year, month, i - firstDay + 1);
    const key = dateKey(date);

    const count = db.tasks.filter(t => t.date === key).length;

    html += `
      <button class="calendar-day
        ${date.getMonth() !== month ? "other" : ""}
        ${key === dateKey() ? "today" : ""}
        ${key === selectedDate ? "selected" : ""}"
        data-action="select-date" data-date="${key}">
        <span class="day-number">${date.getDate()}</span>
        <div class="day-dots">
          ${Array.from(
            { length: Math.min(count, 5) },
            () => `<span class="day-dot"></span>`
          ).join("")}
        </div>
      </button>
    `;
  }

  $("#calendarGrid").innerHTML = html;
  $("#selectedDateTitle").textContent =
    "Tarefas de " + formatDate(selectedDate);

  const tasks = db.tasks.filter(t => t.date === selectedDate);

  $("#calendarTasks").innerHTML = tasks.length
    ? tasks.map(taskHTML).join("")
    : empty("Nenhuma tarefa nesta data.");
}

$("#prevMonth").onclick = () => {
  calendarDate.setDate(1);
  calendarDate.setMonth(calendarDate.getMonth() - 1);
  renderCalendar();
};

$("#nextMonth").onclick = () => {
  calendarDate.setDate(1);
  calendarDate.setMonth(calendarDate.getMonth() + 1);
  renderCalendar();
};

// =====================================
// AGENDA DIÁRIA - NOVA SEÇÃO
// =====================================

let agendaSelected = dateKey();


function renderAgenda() {
  $("#agendaDate").value = agendaSelected;

  $("#agendaHeading").textContent =
    parseDate(agendaSelected).toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });

  const events = db.agenda
    .filter(a => a.date === agendaSelected)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  const completed = events.filter(a => a.done).length;

  $("#agendaSummary").textContent =
    `${events.length} atividades • ${completed} concluídas`;

  // Converte HH:MM em minutos
  function toMinutes(time) {
    if (!time) return 0;

    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }

  let html = "";

  for (let hour = 0; hour < 24; hour++) {
    const hourString = pad(hour);
    const hourStart = hour * 60;
    const hourEnd = hourStart + 60;

    // Busca compromissos que ocupam qualquer parte desta hora
    const hourEvents = events.filter(a => {
      const start = toMinutes(a.time);
      const end = a.endTime
        ? toMinutes(a.endTime)
        : start + 1;

      return start < hourEnd && end > hourStart;
    });

    html += `
      <div class="agenda-hour">
        <div class="agenda-time">${hourString}:00</div>

        <div class="agenda-slot">
          ${hourEvents.map(a => {
            const isFirstHour =
              Math.floor(toMinutes(a.time) / 60) === hour;

            return `
              <div class="agenda-event
                ${a.done ? "done" : ""}
                ${!isFirstHour ? "agenda-event-continued" : ""}">

                <div class="task-info">
                  <strong>${esc(a.title)}</strong>

                  <small>
                    ${esc(a.time)}
                    ${a.endTime ? " até " + esc(a.endTime) : ""}
                  </small>

                  ${isFirstHour && a.description ? `
                    <small>${esc(a.description)}</small>
                  ` : ""}

                  ${!isFirstHour ? `
                    <small>Continuação do compromisso</small>
                  ` : ""}
                </div>

                <div class="agenda-event-actions">
                  <input
                    type="checkbox"
                    class="task-check"
                    data-action="toggle-agenda"
                    data-id="${esc(a.id)}"
                    ${a.done ? "checked" : ""}
                  >

                  <button
                    class="small-btn"
                    data-action="edit-agenda"
                    data-id="${esc(a.id)}"
                    title="Editar">
                    ✎
                  </button>

                  <button
                    class="small-btn"
                    data-action="delete-agenda"
                    data-id="${esc(a.id)}"
                    title="Excluir">
                    ✕
                  </button>
                </div>
              </div>
            `;
          }).join("")}

          <button
            class="agenda-add-hour"
            data-action="agenda-add-hour"
            data-time="${hourString}:00">
            + Adicionar atividade
          </button>
        </div>
      </div>
    `;
  }

  $("#agendaTimeline").innerHTML = html;
}


$("#agendaDate").onchange = event => {
  if (!event.target.value) return;
  agendaSelected = event.target.value;
  renderAgenda();
};

$("#agendaPrev").onclick = () => {
  agendaSelected = addDays(agendaSelected, -1);
  renderAgenda();
};

$("#agendaNext").onclick = () => {
  agendaSelected = addDays(agendaSelected, 1);
  renderAgenda();
};

$("#agendaToday").onclick = () => {
  agendaSelected = dateKey();
  renderAgenda();
};

function toggleAgenda(id) {
  const item = db.agenda.find(a => a.id === id);
  if (!item) return;

  item.done = !item.done;
  saveData();
  renderAll();
}

// =====================================
// FINANCEIRO - NOVA SEÇÃO
// =====================================

const financeMonthInput = $("#financeMonth");
financeMonthInput.value = dateKey().slice(0, 7);

function getFinanceMonth() {
  return financeMonthInput.value || dateKey().slice(0, 7);
}

function totalOf(items, type) {
  return items
    .filter(t => t.type === type)
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
}

function renderFinance() {
  const month = getFinanceMonth();
  const filter = $("#financeFilter").value;

  const monthItems = db.transactions.filter(t =>
    (t.date || "").startsWith(month)
  );

  const income = totalOf(monthItems, "income");
  const expense = totalOf(monthItems, "expense");

  const allIncome = totalOf(db.transactions, "income");
  const allExpense = totalOf(db.transactions, "expense");

  $("#financeIncome").textContent = money(income);
  $("#financeExpense").textContent = money(expense);
  $("#financeBalance").textContent = money(income - expense);
  $("#financeTotal").textContent = money(allIncome - allExpense);

  $("#financeBalance").classList.toggle(
    "money-negative", income - expense < 0
  );

  $("#financeTotal").classList.toggle(
    "money-negative", allIncome - allExpense < 0
  );

  let visible = monthItems;

  if (filter !== "all") {
    visible = visible.filter(t => t.type === filter);
  }

  visible = [...visible].sort((a, b) =>
    (b.date || "").localeCompare(a.date || "")
  );

  $("#transactionCount").textContent =
    `${visible.length} lançamentos`;

  $("#transactionList").innerHTML = visible.length
    ? visible.map(t => `
        <div class="transaction-row">
          <div class="transaction-icon">
            ${t.type === "income" ? "↗" : "↘"}
          </div>

          <div class="transaction-info">
            <strong>${esc(t.title)}</strong>
            <small>
              ${esc(t.category || "Outros")} • ${formatDate(t.date)}
            </small>
            ${t.description ? `<small>${esc(t.description)}</small>` : ""}
          </div>

          <div class="transaction-amount
            ${t.type === "expense" ? "money-negative" : ""}">
            ${t.type === "income" ? "+" : "−"} ${money(t.amount)}
          </div>

          <div class="task-actions">
            <button class="small-btn" data-action="edit-transaction"
              data-id="${esc(t.id)}">✎</button>
            <button class="small-btn" data-action="delete-transaction"
              data-id="${esc(t.id)}">✕</button>
          </div>
        </div>
      `).join("")
    : empty("Nenhuma movimentação neste mês.");

  renderFinanceMonthlyChart();
  renderFinanceCategories(monthItems);
  renderFinanceEvolution();
  renderSavingGoals();
}

function monthShift(monthString, offset) {
  const [year, month] = monthString.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function renderFinanceMonthlyChart() {
  const current = getFinanceMonth();

  const months = Array.from({ length: 6 }, (_, i) => {
    const key = monthShift(current, i - 5);

    const items = db.transactions.filter(t =>
      (t.date || "").startsWith(key)
    );

    return {
      key,
      income: totalOf(items, "income"),
      expense: totalOf(items, "expense")
    };
  });

  const max = Math.max(
    1,
    ...months.flatMap(m => [m.income, m.expense])
  );

  $("#financeMonthlyChart").innerHTML = months.map(m => {
    const label = parseDate(m.key + "-01")
      .toLocaleDateString("pt-BR", { month: "short" });

    return `
      <div class="finance-month">
        <div class="finance-month-bars">
          <div class="finance-bar income"
            style="height:${Math.max(2, m.income / max * 180)}px"
            title="Entradas: ${money(m.income)}"></div>

          <div class="finance-bar expense"
            style="height:${Math.max(2, m.expense / max * 180)}px"
            title="Despesas: ${money(m.expense)}"></div>
        </div>
        <span class="finance-month-label">${esc(label)}</span>
      </div>
    `;
  }).join("");
}

function renderFinanceCategories(monthItems) {
  const expenses = monthItems.filter(t => t.type === "expense");

  const totals = {};

  expenses.forEach(t => {
    const category = t.category || "Outros";
    totals[category] = (totals[category] || 0) +
      (Number(t.amount) || 0);
  });

  const entries = Object.entries(totals)
    .sort((a, b) => b[1] - a[1]);

  const total = expenses.reduce(
    (sum, t) => sum + Number(t.amount || 0), 0
  );

  $("#financeCategoryChart").innerHTML = entries.length
    ? entries.map(([category, value]) => {
        const percent = pct(value, total);

        return `
          <div class="finance-category">
            <div class="progress-label">
              <span>${esc(category)}</span>
              <strong>${money(value)} (${percent}%)</strong>
            </div>
            <div class="progress-bar">
              <div class="progress-fill"
                style="width:${percent}%"></div>
            </div>
          </div>
        `;
      }).join("")
    : empty("Registre despesas para visualizar as categorias.");
}

function renderFinanceEvolution() {
  const current = getFinanceMonth();

  const months = Array.from({ length: 6 }, (_, i) => {
    const key = monthShift(current, i - 5);

    const items = db.transactions.filter(t =>
      (t.date || "").slice(0, 7) <= key
    );

    return {
      key,
      balance: totalOf(items, "income") -
        totalOf(items, "expense")
    };
  });

  const max = Math.max(
    1,
    ...months.map(m => Math.abs(m.balance))
  );

  $("#financeEvolution").innerHTML = `
    <div class="evolution-list">
      ${months.map(m => `
        <div class="evolution-row">
          <span>${esc(parseDate(m.key + "-01")
            .toLocaleDateString("pt-BR", { month: "short" }))}</span>

          <div class="evolution-track">
            <div class="evolution-fill"
              style="width:${Math.abs(m.balance) / max * 100}%;
              ${m.balance < 0 ? "opacity:.35" : ""}"></div>
          </div>

          <strong class="${m.balance < 0 ? "money-negative" : ""}">
            ${money(m.balance)}
          </strong>
        </div>
      `).join("")}
    </div>
    <p class="muted" style="font-size:11px;margin-top:15px">
      Saldo acumulado até o fim de cada mês, considerando os lançamentos cadastrados.
    </p>
  `;
}

function renderSavingGoals() {
  $("#savingGoalsList").innerHTML = db.savingGoals.length
    ? db.savingGoals.map(g => {
        const percent = clamp(pct(g.current, g.target));

        return `
          <div class="saving-goal">
            <div class="saving-goal-header">
              <strong>${esc(g.title)}</strong>
              <div class="saving-goal-actions">
                <button class="small-btn" data-action="saving-minus"
                  data-id="${esc(g.id)}">−</button>
                <button class="small-btn" data-action="saving-plus"
                  data-id="${esc(g.id)}">+</button>
                <button class="small-btn" data-action="edit-saving"
                  data-id="${esc(g.id)}">✎</button>
                <button class="small-btn" data-action="delete-saving"
                  data-id="${esc(g.id)}">✕</button>
              </div>
            </div>

            <div class="progress-label">
              <span>${money(g.current)} / ${money(g.target)}</span>
              <strong>${percent}%</strong>
            </div>

            <div class="progress-bar">
              <div class="progress-fill"
                style="width:${percent}%"></div>
            </div>

            <small>Prazo: ${formatDate(g.deadline)}</small>
          </div>
        `;
      }).join("")
    : empty("Crie uma meta para economizar dinheiro.");
}

function changeSavingGoal(id, direction) {
  const goal = db.savingGoals.find(g => g.id === id);
  if (!goal) return;

  const response = prompt(
    direction > 0
      ? "Quanto deseja adicionar à economia? (R$)"
      : "Quanto deseja retirar da economia? (R$)",
    "50"
  );

  if (response === null) return;

  const amount = Number(response.replace(",", "."));

  if (!Number.isFinite(amount) || amount <= 0) {
    return toast("Informe um valor válido.");
  }

  goal.current = Math.max(
    0,
    Math.round((Number(goal.current) + amount * direction) * 100) / 100
  );

  saveData();
  renderAll();
  toast("Meta de economia atualizada!");
}

financeMonthInput.onchange = renderFinance;
$("#financeFilter").onchange = renderFinance;

// =====================================
// ESTUDOS - NOVA SEÇÃO
// =====================================

function studyMinutes(id) {
  return db.studySessions
    .filter(s => s.studyId === id)
    .reduce((sum, s) => sum + Number(s.minutes || 0), 0);
}

function formatHours(minutes) {
  const hours = minutes / 60;
  return hours.toLocaleString("pt-BR", {
    maximumFractionDigits: 1
  }) + "h";
}

function studyTypeLabel(type) {
  return {
    subject: "Matéria",
    course: "Curso",
    skill: "Habilidade"
  }[type] || "Matéria";
}

function renderStudies() {
  const totalMinutes = db.studySessions.reduce(
    (sum, s) => sum + Number(s.minutes || 0), 0
  );

  const totalContents = db.studies.reduce(
    (sum, s) => sum + (s.contents || []).filter(c => c.done).length,
    0
  );

  const weekStart = addDays(dateKey(), -6);

  const weekMinutes = db.studySessions
    .filter(s => s.date >= weekStart && s.date <= dateKey())
    .reduce((sum, s) => sum + Number(s.minutes || 0), 0);

  $("#studyTotal").textContent = db.studies.length;
  $("#studyHours").textContent = formatHours(totalMinutes);
  $("#studyCompleted").textContent = totalContents;
  $("#studyWeekHours").textContent = formatHours(weekMinutes);

  renderStudyChart();
  renderStudyDistribution();

  const selected = $("#sessionSubject").value;

  $("#sessionSubject").innerHTML = db.studies.length
    ? db.studies.map(s => `
        <option value="${esc(s.id)}">${esc(s.title)}</option>
      `).join("")
    : `<option value="">Cadastre um assunto primeiro</option>`;

  if (db.studies.some(s => s.id === selected)) {
    $("#sessionSubject").value = selected;
  }

  $("#studyList").innerHTML = db.studies.length
    ? db.studies.map(s => {
        const contents = s.contents || [];
        const done = contents.filter(c => c.done).length;
        const percent = pct(done, contents.length);
        const minutes = studyMinutes(s.id);

        return `
          <div class="data-card">
            <div class="card-top">
              <div>
                <span class="tag">${studyTypeLabel(s.type)}</span>
                <h3 style="margin-top:12px">${esc(s.title)}</h3>
              </div>
              <div class="card-actions">
                <button class="small-btn" data-action="edit-study"
                  data-id="${esc(s.id)}">✎</button>
                <button class="small-btn" data-action="delete-study"
                  data-id="${esc(s.id)}">✕</button>
              </div>
            </div>

            <p>${esc(s.description || "Sem descrição.")}</p>

            <div class="study-card-metrics">
              <span>
                <strong>${formatHours(minutes)}</strong>
                Estudadas
              </span>
              <span>
                <strong>${done}/${contents.length}</strong>
                Conteúdos
              </span>
              <span>
                <strong>${percent}%</strong>
                Concluído
              </span>
            </div>

            <div class="progress-bar">
              <div class="progress-fill"
                style="width:${percent}%"></div>
            </div>

            ${Number(s.targetHours) > 0 ? `
              <p>Meta de tempo:
                ${formatHours(minutes)} de ${s.targetHours}h
              </p>
              <div class="progress-bar">
                <div class="progress-fill"
                  style="width:${clamp(pct(minutes, s.targetHours * 60))}%">
                </div>
              </div>
            ` : ""}

            ${contents.length ? `
              <h3 style="margin-top:20px">Conteúdos</h3>
              ${contents.map(c => `
                <label class="study-content ${c.done ? "done" : ""}">
                  <input type="checkbox" class="task-check"
                    data-action="toggle-study-content"
                    data-id="${esc(s.id)}"
                    data-content="${esc(c.id)}"
                    ${c.done ? "checked" : ""}>
                  <span>${esc(c.title)}</span>
                </label>
              `).join("")}
            ` : `<p>Adicione conteúdos ao editar o assunto.</p>`}
          </div>
        `;
      }).join("")
    : empty("Cadastre seu primeiro curso, matéria ou habilidade.");

  const sessions = [...db.studySessions].sort(
    (a, b) => (b.date || "").localeCompare(a.date || "")
  );

  $("#studySessionList").innerHTML = sessions.length
    ? sessions.slice(0, 30).map(s => {
        const subject = db.studies.find(x => x.id === s.studyId);

        return `
          <div class="study-session-row">
            <div>
              <strong>${esc(subject?.title || "Assunto excluído")}</strong>
              <small>${formatDate(s.date)}</small>
            </div>

            <b>${formatHours(s.minutes)}</b>

            <button class="small-btn" data-action="delete-study-session"
              data-id="${esc(s.id)}">✕</button>
          </div>
        `;
      }).join("")
    : empty("Nenhuma sessão de estudo registrada.");
}

function renderStudyChart() {
  const days = [];

  for (let i = 6; i >= 0; i--) {
    const key = addDays(dateKey(), -i);

    const minutes = db.studySessions
      .filter(s => s.date === key)
      .reduce((sum, s) => sum + Number(s.minutes || 0), 0);

    days.push({
      label: parseDate(key).toLocaleDateString(
        "pt-BR", { weekday: "short" }
      ).replace(".", ""),
      value: minutes / 60
    });
  }

  const max = Math.max(1, ...days.map(d => d.value));

  $("#studyWeekChart").innerHTML = days.map(d => `
    <div class="chart-column">
      <span class="chart-value">
        ${d.value.toLocaleString("pt-BR", {
          maximumFractionDigits: 1
        })}h
      </span>

      <div class="chart-bar"
        style="height:${Math.max(2, d.value / max * 170)}px">
      </div>

      <span class="chart-label">${esc(d.label)}</span>
    </div>
  `).join("");
}

function renderStudyDistribution() {
  const values = db.studies.map(s => ({
    title: s.title,
    minutes: studyMinutes(s.id)
  })).filter(s => s.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  const total = values.reduce((sum, s) => sum + s.minutes, 0);

  $("#studyDistribution").innerHTML = values.length
    ? values.map(s => {
        const percent = pct(s.minutes, total);

        return `
          <div class="finance-category">
            <div class="progress-label">
              <span>${esc(s.title)}</span>
              <strong>${formatHours(s.minutes)} (${percent}%)</strong>
            </div>
            <div class="progress-bar">
              <div class="progress-fill"
                style="width:${percent}%"></div>
            </div>
          </div>
        `;
      }).join("")
    : empty("Registre horas de estudo para visualizar os gráficos.");
}

$("#studySessionForm").addEventListener("submit", event => {
  event.preventDefault();

  const studyId = $("#sessionSubject").value;
  const date = $("#sessionDate").value;
  const minutes = Number($("#sessionMinutes").value);

  if (!db.studies.some(s => s.id === studyId)) {
    return toast("Cadastre um assunto primeiro.");
  }

  if (!date || !Number.isInteger(minutes) ||
      minutes <= 0 || minutes > 1440) {
    return toast("Informe uma data e minutos válidos.");
  }

  db.studySessions.push({
    id: uid(),
    studyId,
    date,
    minutes,
    createdAt: new Date().toISOString()
  });

  saveData();
  renderAll();
  toast("Sessão de estudo registrada!");
});

function toggleStudyContent(studyId, contentId) {
  const study = db.studies.find(s => s.id === studyId);
  const content = study?.contents?.find(c => c.id === contentId);

  if (!content) return;

  content.done = !content.done;
  saveData();
  renderAll();
}

// =====================================
// MODO FOCO
// =====================================

const timerModes = {
  focus: 25 * 60,
  short: 5 * 60,
  long: 15 * 60
};

let timerMode = "focus";
let timerRemaining = timerModes.focus;
let timerRunning = false;
let timerInterval = null;
let timerDeadline = null;

function updateTimerDisplay() {
  const minutes = Math.floor(timerRemaining / 60);
  const seconds = timerRemaining % 60;

  $("#timerDisplay").textContent =
    `${pad(minutes)}:${pad(seconds)}`;

  document.title = timerRunning
    ? `${pad(minutes)}:${pad(seconds)} | Leme Planner`
    : "Leme Planner | Produtividade";
}

function stopTimer() {
  timerRunning = false;
  clearInterval(timerInterval);
  timerInterval = null;
  timerDeadline = null;
  $("#timerStart").textContent = "Iniciar";
}

function tickTimer() {
  if (!timerRunning) return;

  timerRemaining = Math.max(
    0,
    Math.ceil((timerDeadline - Date.now()) / 1000)
  );

  updateTimerDisplay();

  if (timerRemaining <= 0) {
    stopTimer();

    if (timerMode === "focus") {
      db.focusSessions.push({
        id: uid(),
        date: dateKey(),
        minutes: 25,
        completedAt: new Date().toISOString()
      });

      saveData();
      renderAll();
      toast("Sessão de foco concluída!");
    } else {
      toast("Pausa finalizada!");
    }

    updateTimerDisplay();
  }
}

function startTimer() {
  if (timerRunning) {
    tickTimer();

    if (!timerRunning) return;

    timerRemaining = Math.max(
      0,
      Math.ceil((timerDeadline - Date.now()) / 1000)
    );

    stopTimer();
    updateTimerDisplay();
    return;
  }

  timerRunning = true;
  timerDeadline = Date.now() + timerRemaining * 1000;

  $("#timerStart").textContent = "Pausar";

  timerInterval = setInterval(tickTimer, 250);
  tickTimer();
}

function resetTimer() {
  stopTimer();
  timerRemaining = timerModes[timerMode];
  updateTimerDisplay();
}

$("#timerStart").onclick = startTimer;
$("#timerReset").onclick = resetTimer;

$$(".mode-btn").forEach(btn => {
  btn.onclick = () => {
    timerMode = btn.dataset.mode;
    resetTimer();

    $$(".mode-btn").forEach(b => {
      b.classList.toggle("active", b === btn);
    });

    $("#focusModeLabel").textContent = {
      focus: "SESSÃO DE FOCO",
      short: "PAUSA CURTA",
      long: "PAUSA LONGA"
    }[timerMode];
  };
});

function renderFocus() {
  const sessions = db.focusSessions;

  const minutes = sessions.reduce(
    (sum, s) => sum + Number(s.minutes || 0), 0
  );

  $("#focusSessions").textContent = sessions.length;
  $("#focusMinutes").textContent = minutes;
  $("#focusToday").textContent =
    sessions.filter(s => s.date === dateKey()).length;
}

// =====================================
// ESTATÍSTICAS ORIGINAIS
// =====================================

function renderStats() {
  const done = db.tasks.filter(t => t.done);

  const goalsDone = db.goals.filter(g =>
    Number(g.current) >= Number(g.target)
  ).length;

  const minutes = db.focusSessions.reduce(
    (sum, s) => sum + Number(s.minutes || 0), 0
  );

  $("#allDone").textContent = done.length;
  $("#completionRate").textContent =
    pct(done.length, db.tasks.length) + "%";
  $("#goalsDone").textContent = goalsDone;

  $("#focusHours").textContent =
    (minutes / 60).toFixed(1).replace(".", ",");

  renderWeeklyChart();
  renderDistribution();

  $("#productivitySummary").innerHTML = `
    <p>Você cadastrou <strong>${db.tasks.length}</strong>
      tarefas e concluiu <strong>${done.length}</strong>.</p>

    <p>Possui <strong>${db.goals.length}</strong> metas,
      sendo <strong>${goalsDone}</strong> concluídas.</p>

    <p>Realizou <strong>${db.focusSessions.length}</strong>
      sessões de foco, totalizando <strong>${minutes}</strong>
      minutos de concentração.</p>
  `;
}

function renderWeeklyChart() {
  const days = [];

  for (let i = 6; i >= 0; i--) {
    const key = addDays(dateKey(), -i);

    const count = db.tasks.filter(t =>
      t.done &&
      t.completedAt &&
      dateKey(new Date(t.completedAt)) === key
    ).length;

    days.push({
      label: parseDate(key).toLocaleDateString(
        "pt-BR", { weekday: "short" }
      ).replace(".", ""),
      count
    });
  }

  const max = Math.max(1, ...days.map(d => d.count));

  $("#weeklyChart").innerHTML = days.map(d => `
    <div class="chart-column">
      <span class="chart-value">${d.count}</span>
      <div class="chart-bar"
        style="height:${Math.max(2, d.count / max * 170)}px">
      </div>
      <span class="chart-label">${esc(d.label)}</span>
    </div>
  `).join("");
}

function renderDistribution() {
  const total = db.tasks.length;
  const done = db.tasks.filter(t => t.done).length;
  const pending = total - done;

  const overdue = db.tasks.filter(t =>
    !t.done && t.date && t.date < dateKey()
  ).length;

  const groups = [
    ["Concluídas", done],
    ["Pendentes", pending],
    ["Atrasadas", overdue]
  ];

  $("#distributionChart").innerHTML = groups.map(([name, value]) => {
    const percent = pct(value, total);

    return `
      <div class="distribution-row">
        <div class="progress-label">
          <span>${name}</span>
          <strong>${value} (${percent}%)</strong>
        </div>
        <div class="progress-bar">
          <div class="progress-fill"
            style="width:${percent}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

// =====================================
// CONFIGURAÇÕES E BACKUP
// =====================================

function applyTheme() {
  document.body.classList.toggle(
    "dark",
    db.settings.theme === "dark"
  );

  $("#themeToggle").textContent =
    db.settings.theme === "dark" ? "☀" : "◐";
}

$("#themeToggle").onclick = () => {
  db.settings.theme =
    db.settings.theme === "dark" ? "light" : "dark";

  saveData();
  applyTheme();
};

$("#saveName").onclick = () => {
  db.settings.name = $("#userName").value.trim();
  saveData();
  renderGreeting();
  toast("Nome salvo!");
};

function renderSettings() {
  if (document.activeElement !== $("#userName")) {
    $("#userName").value = db.settings.name;
  }
}

$("#exportData").onclick = () => {
  const backup = {
    app: "Leme Planner",
    version: 3,
    exportedAt: new Date().toISOString(),
    data: db
  };

  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `leme-planner-backup-${dateKey()}.json`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Backup exportado!");
};

$("#importData").onclick = () => $("#importFile").click();

$("#importFile").onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const backup = JSON.parse(await file.text());

    if (
      backup.app !== "Leme Planner" ||
      ![1, 2, 3].includes(backup.version) ||
      !backup.data ||
      !Array.isArray(backup.data.tasks) ||
      !Array.isArray(backup.data.goals) ||
      !Array.isArray(backup.data.habits) ||
      !Array.isArray(backup.data.projects) ||
      !Array.isArray(backup.data.focusSessions)
    ) {
      throw new Error("Backup inválido");
    }

    if (!confirm(
      "Importar este backup substituirá os dados atuais. Continuar?"
    )) return;

    const previous = db;
    db = normalizeData(backup.data);

    if (!saveData()) {
      db = previous;
      return;
    }

    applyTheme();
    renderAll();
    toast("Backup restaurado!");

  } catch (error) {
    console.error(error);
    toast("Não foi possível importar o backup.");
  } finally {
    event.target.value = "";
  }
};

$("#clearData").onclick = () => {
  if (!confirm(
    "ATENÇÃO: esta ação apaga todas as tarefas, finanças, estudos, agenda e demais dados, INCLUSIVE NA NUVEM e em outros dispositivos após sincronizar. Exporte um backup antes. Continuar?"
  )) return;

  db = blankData();
  saveData();
  resetTimer();
  applyTheme();
  renderAll();
  toast("Dados apagados.");
};

// =====================================
// EXCLUSÕES E AÇÕES
// =====================================

function deleteItem(collection, id) {
  const item = db[collection].find(x => x.id === id);
  if (!item) return;

  if (!confirm(`Deseja excluir "${item.title || "este registro"}"?`)) {
    return;
  }

  db[collection] = db[collection].filter(x => x.id !== id);

  if (collection === "projects") {
    db.tasks.forEach(t => {
      if (t.projectId === id) t.projectId = "";
    });
  }

  if (collection === "studies") {
    db.studySessions = db.studySessions.filter(
      s => s.studyId !== id
    );
  }

  saveData();
  renderAll();
  toast("Item excluído.");
}

document.addEventListener("change", event => {
  const el = event.target;
  if (!el.matches(".task-check[data-action]")) return;

  const action = el.dataset.action;
  const id = el.dataset.id;

  if (action === "toggle-task") toggleTask(id);
  
if (action === "toggle-task-checklist") {
  toggleTaskChecklist(id, el.dataset.content);
}

  if (action === "toggle-habit") toggleHabit(id);
  
// MARCAR / DESMARCAR DIA NO CALENDÁRIO
if (action === "habit-calendar-toggle") {
  toggleHabit(id, btn.dataset.date);
}

// NAVEGAR PARA O MÊS ANTERIOR
if (action === "habit-calendar-prev") {
  const current =
    habitCalendarMonths[id] || dateKey().slice(0, 7);

  habitCalendarMonths[id] = monthShift(current, -1);
  renderHabits();
}

// NAVEGAR PARA O PRÓXIMO MÊS
if (action === "habit-calendar-next") {
  const current =
    habitCalendarMonths[id] || dateKey().slice(0, 7);

  const next = monthShift(current, 1);

  if (next <= dateKey().slice(0, 7)) {
    habitCalendarMonths[id] = next;
    renderHabits();
  }
}

  if (action === "toggle-agenda") toggleAgenda(id);

  if (action === "toggle-study-content") {
    toggleStudyContent(id, el.dataset.content);
  }
});

document.addEventListener("click", event => {
  const btn = event.target.closest("[data-action]");
  if (!btn) return;

  if (btn.matches(".task-check")) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  for (const type of [
    "task", "goal", "habit", "project",
    "transaction", "saving", "study", "agenda"
  ]) {
    if (action === "edit-" + type) {
      openModal(type, id);
    }

    if (action === "delete-" + type) {
      deleteItem(collections[type], id);
    }
  }

  if (action === "toggle-habit") toggleHabit(id);

  if (action === "goal-plus") changeGoal(id, 1);
  if (action === "goal-minus") changeGoal(id, -1);

  if (action === "saving-plus") changeSavingGoal(id, 1);
  if (action === "saving-minus") changeSavingGoal(id, -1);

  if (action === "project-task") {
    openModal("task", null, { projectId: id });
  }


if (action === "select-date") {
  selectedDate = btn.dataset.date;
  calendarDate = parseDate(selectedDate);

  // Ativa o filtro da data selecionada
  $("#taskFilter").value = "selected";

  // Mostra todas as prioridades desse dia
  $("#taskPriorityFilter").value = "all";

  // Limpa a pesquisa anterior
  $("#taskSearch").value = "";

  // Abre diretamente as tarefas daquele dia
  navigate("tasks");

  toast(
    "Mostrando tarefas de " + formatDate(selectedDate)
  );
}


  if (action === "agenda-add-hour") {
    openModal("agenda", null, {
      date: agendaSelected,
      time: btn.dataset.time
    });
  }

  if (action === "delete-study-session") {
    if (!confirm("Excluir esta sessão de estudo?")) return;

    db.studySessions = db.studySessions.filter(
      s => s.id !== id
    );

    saveData();
    renderAll();
    toast("Sessão excluída.");
  }
});

// =====================================
// BOTÕES PARA ADICIONAR
// =====================================

const addButtons = {
  quickAddBtn: "task",
  addTaskBtn: "task",
  calendarAddBtn: "task",
  addGoalBtn: "goal",
  addHabitBtn: "habit",
  addProjectBtn: "project",
  addTransactionBtn: "transaction",
  addSavingGoalBtn: "saving",
  addSavingGoalInline: "saving",
  addStudyBtn: "study",
  addAgendaBtn: "agenda"
};

Object.entries(addButtons).forEach(([id, type]) => {
  $("#" + id).onclick = () => openModal(type);
});

$("#addSelectedDate").onclick = () => {
  openModal("task", null, { date: selectedDate });
};

// =====================================
// ATUALIZAÇÃO GERAL
// =====================================

function renderAll() {
  renderGreeting();
  renderDashboard();
  renderTasks();
  renderCalendar();
  renderAgenda();
  renderGoals();
  renderHabits();
  renderProjects();
  renderFinance();
  renderStudies();
  renderFocus();
  renderStats();
  renderSettings();
}

function initialize() {
  $("#agendaDate").value = dateKey();
  $("#sessionDate").value = dateKey();

  applyTheme();
  updateTimerDisplay();
  renderAll();
  navigate("dashboard");

  console.log("Leme Planner expandido iniciado!");
}


function toggleTaskChecklist(taskId, contentId) {
  const task = db.tasks.find(t => t.id === taskId);

  if (!task || !Array.isArray(task.checklist)) return;

  const content = task.checklist.find(
    c => c.id === contentId
  );

  if (!content) return;

  content.done = !content.done;

  saveData();
  renderAll();
}


initialize();
