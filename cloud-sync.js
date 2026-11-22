/* Leme One - sincronizacao com Cloudflare (mantem as funcoes originais do script.js) */
"use strict";
(() => {
  const API = String(window.LEME_CLOUD_API || "").replace(/\/+$/, "");
  const STORAGE_AUTH = "lemeone_cloud_auth_v1";
  const CACHE_PREFIX = "lemeone_cloud_cache_v1_";
  const META_PREFIX = "lemeone_cloud_meta_v1_";
  const LEGACY_KEY = "leme_planner_v1";
  const ENCODER = new TextEncoder();
  const COLLECTIONS = [
    "tasks", "goals", "habits", "projects", "focusSessions", "transactions",
    "savingGoals", "studies", "studySessions", "agenda"
  ];
  const gate = document.getElementById("cloudGate");
  const authPane = document.getElementById("cloudAuthPane");
  const migrationPane = document.getElementById("cloudMigrationPane");
  const conflictPane = document.getElementById("cloudConflictPane");
  const form = document.getElementById("cloudAuthForm");
  const statusText = document.getElementById("cloudSyncStatus");
  const accountText = document.getElementById("cloudAccountName");

  let session = readJSON(STORAGE_AUTH);
  let active = false;
  let version = 0;
  let dirty = false;
  let conflict = false;
  let busy = false;
  let changes = 0;
  let pushTimer = null;
  let lastSynced = null;
  let selectedMode = "login";
  let migrationRemote = null;
  let conflictRemote = null;

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch { return null; }
  }
  function cacheKey() { return CACHE_PREFIX + session.user.id; }
  function metaKey() { return META_PREFIX + session.user.id; }
  function writeMeta() {
    localStorage.setItem(metaKey(), JSON.stringify({ version, dirty }));
  }
  function storeCache() {
    localStorage.setItem(cacheKey(), JSON.stringify(db));
    writeMeta();
  }
  function hasLegacyRecords(data) {
    return !!data && typeof data === "object" &&
      (COLLECTIONS.some(k => Array.isArray(data[k]) && data[k].length > 0) ||
       !!data.settings?.name?.trim());
  }
  function setText(message, isError = false) {
    const el = document.getElementById("cloudGateMessage");
    el.textContent = message;
    el.classList.toggle("cloud-error", isError);
  }
  function syncStatus(text, problematic = false) {
    statusText.textContent = text;
    statusText.classList.toggle("cloud-status-warning", problematic);
    accountText.textContent = session?.user?.username
      ? `@${session.user.username}` : "Não conectado";
  }
  function showPane(which) {
    gate.hidden = false;
    authPane.hidden = which !== "auth";
    migrationPane.hidden = which !== "migration";
    conflictPane.hidden = which !== "conflict";
  }
  function hideGate() { gate.hidden = true; }
  function setBusy(button, working) {
    button.disabled = working;
    button.textContent = working
      ? "Aguarde..."
      : (selectedMode === "login" ? "Entrar na minha conta" : "Criar conta e entrar");
  }
  function switchMode(mode) {
    selectedMode = mode;
    document.getElementById("cloudCodeGroup").hidden = mode !== "register";
    document.getElementById("cloudRegistrationCode").required = mode === "register";
    document.getElementById("cloudAuthSubmit").textContent =
      mode === "login" ? "Entrar na minha conta" : "Criar conta e entrar";
    document.getElementById("cloudRegisterTab").classList.toggle("active", mode === "register");
    document.getElementById("cloudLoginTab").classList.toggle("active", mode === "login");
    document.getElementById("cloudAuthTitle").textContent =
      mode === "login" ? "Entrar no Leme One" : "Criar minha conta";
    setText(mode === "login"
      ? "Use sua conta para acessar os mesmos dados em qualquer aparelho."
      : "O código de cadastro foi definido nas configurações do seu Worker.");
  }
  function normalizeUsername(value) {
    return String(value || "").toLowerCase().trim();
  }
  function bytesToHex(buffer) {
    return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("");
  }
  function hexToBytes(value) {
    const bytes = new Uint8Array(value.length / 2);
    for (let i = 0; i < value.length; i += 2) {
      bytes[i / 2] = parseInt(value.slice(i, i + 2), 16);
    }
    return bytes;
  }
  function makeSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return bytesToHex(bytes);
  }
  async function deriveVerifier(password, salt, iterations = 600000) {
    const base = await crypto.subtle.importKey(
      "raw", ENCODER.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: hexToBytes(salt), iterations, hash: "SHA-256" },
      base, 256
    );
    return bytesToHex(bits);
  }
  async function api(path, method = "GET", body = null, authenticated = true) {
    const headers = {};
    if (body !== null) headers["Content-Type"] = "application/json";
    if (authenticated && session?.token) {
      headers.Authorization = `Bearer ${session.token}`;
    }
    let response;
    try {
      response = await fetch(API + path, {
        method, headers,
        body: body === null ? undefined : JSON.stringify(body),
        cache: "no-store"
      });
    } catch (_) {
      const err = new Error("Falha de conexão com a Cloudflare. Verifique internet, Worker e APP_ORIGINS.");
      err.network = true;
      throw err;
    }
    let data = null;
    try { data = await response.json(); }
    catch { data = {}; }
    if (!response.ok) {
      const err = new Error(data.error || `Erro HTTP ${response.status}`);
      err.status = response.status;
      err.payload = data;
      throw err;
    }
    return data;
  }
  function installData(data, newVersion) {
    db = normalizeData(data || blankData());
    version = newVersion;
    dirty = false;
    conflict = false;
    storeCache();
    applyTheme();
    renderAll();
    lastSynced = new Date();
    syncStatus("Sincronizado com a nuvem");
    hideGate();
  }
  function useCachedData(data, meta) {
    db = normalizeData(data);
    version = Number(meta.version) || 0;
    dirty = !!meta.dirty;
    active = true;
    applyTheme();
    renderAll();
    syncStatus(dirty ? "Alterações pendentes de envio" : "Sem conexão — cópia local", true);
    hideGate();
  }
  function downloadBackup(data, filename) {
    const blob = new Blob([JSON.stringify({
      app: "Leme Planner", version: 3,
      exportedAt: new Date().toISOString(), data
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function showConflict(remote) {
    conflictRemote = remote;
    conflict = true;
    syncStatus("Conflito entre dispositivos — escolha a versão", true);
    showPane("conflict");
  }
  async function finishAuthorization(remote) {
    const cached = readJSON(cacheKey());
    const meta = readJSON(metaKey());
    active = true;
    version = remote.version;

    if (cached && meta && meta.dirty) {
      useCachedData(cached, meta);
      if (meta.version !== remote.version) {
        showConflict(remote);
      } else {
        schedulePush(0);
      }
      return;
    }
    if (cached && meta && !meta.dirty) {
      installData(remote.data, remote.version);
      return;
    }

    const legacy = readJSON(LEGACY_KEY);
    if (hasLegacyRecords(legacy)) {
      migrationRemote = remote;
      document.getElementById("cloudMigrationDescription").textContent =
        remote.version === 0
          ? "Encontramos dados antigos neste navegador. Você pode enviá-los para sua conta ou começar com a nuvem vazia."
          : "Esta conta já possui dados na nuvem e encontramos dados locais antigos. Escolha qual versão deseja utilizar; elas não serão mescladas.";
      document.getElementById("cloudMigrateUpload").textContent =
        remote.version === 0
          ? "Enviar meus dados locais para a nuvem"
          : "Substituir nuvem pelos dados locais";
      showPane("migration");
      return;
    }
    installData(remote.data, remote.version);
  }
  function schedulePush(delay = 1100) {
    clearTimeout(pushTimer);
    if (!active || !dirty || conflict) return;
    pushTimer = setTimeout(push, delay);
  }
  function saveChange(data) {
    if (!active || !session?.user) return false;
    try {
      localStorage.setItem(cacheKey(), JSON.stringify(data));
      dirty = true;
      changes++;
      writeMeta();
      syncStatus("Salvando alterações...");
      schedulePush();
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }
  async function push() {
    if (!active || !session || !dirty || busy || conflict) return;
    busy = true;
    syncStatus("Enviando dados...");
    const index = changes;
    const snapshot = JSON.parse(JSON.stringify(db));
    const expected = version;
    try {
      const result = await api("/api/data", "PUT", { version: expected, data: snapshot });
      version = result.version;
      dirty = index !== changes;
      writeMeta();
      if (!dirty) {
        lastSynced = new Date();
        syncStatus("Sincronizado com a nuvem");
      } else {
        syncStatus("Enviando alterações mais recentes...");
      }
    } catch (error) {
      if (error.status === 409 && error.payload) {
        showConflict(error.payload);
      } else if (error.status === 401) {
        active = false;
        syncStatus("Sessão expirada. Entre novamente.", true);
        showPane("auth");
      } else {
        syncStatus("Não sincronizado — dados locais preservados", true);
      }
    } finally {
      busy = false;
      if (dirty && !conflict && active) schedulePush(4000);
    }
  }
  async function pull() {
    if (!active || !session || busy || conflict) return;
    if (document.getElementById("modalOverlay")?.classList.contains("open")) return;
    if (dirty) return push();
    busy = true;
    const revision = changes;
    try {
      const remote = await api("/api/data");
      if (revision !== changes || dirty) {
        if (remote.version !== version) showConflict(remote);
      } else if (remote.version !== version) {
        installData(remote.data, remote.version);
      } else {
        lastSynced = new Date();
        syncStatus("Sincronizado com a nuvem");
      }
    } catch (error) {
      if (error.status === 401) {
        active = false;
        syncStatus("Sessão expirada. Entre novamente.", true);
        showPane("auth");
      } else {
        syncStatus("Sem conexão — usando cópia local", true);
      }
    } finally { busy = false; }
  }
  async function resume() {
    if (!session?.token || !session?.user?.id) {
      session = null;
      showPane("auth");
      return;
    }
    setText("Verificando sua sessão e carregando os dados...");
    try {
      const me = await api("/api/me");
      session.user = me.user;
      localStorage.setItem(STORAGE_AUTH, JSON.stringify(session));
      const remote = await api("/api/data");
      await finishAuthorization(remote);
    } catch (error) {
      if (error.status === 401) {
        session = null;
        localStorage.removeItem(STORAGE_AUTH);
        setText("Sua sessão expirou. Entre novamente.", true);
        showPane("auth");
      } else {
        const cache = readJSON(cacheKey());
        const meta = readJSON(metaKey());
        if (cache && meta) {
          useCachedData(cache, meta);
        } else {
          setText(error.message + " Tente novamente quando a API estiver disponível.", true);
          showPane("auth");
        }
      }
    }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("cloudAuthSubmit");
    const username = normalizeUsername(document.getElementById("cloudUsername").value);
    const password = document.getElementById("cloudPassword").value;
    const code = document.getElementById("cloudRegistrationCode").value.trim();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return setText("Use de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.", true);
    }
    if (password.length < 10 || password.length > 128) {
      return setText("A senha precisa ter de 10 a 128 caracteres.", true);
    }
    if (selectedMode === "register" && !code) {
      return setText("Informe o código de cadastro configurado no Worker.", true);
    }
    setBusy(button, true);
    setText("Protegendo sua senha e conectando à nuvem...");
    try {
      let salt, verifier, result;
      if (selectedMode === "register") {
        salt = makeSalt();
        verifier = await deriveVerifier(password, salt);
        result = await api("/api/register", "POST", {
          username, verifier, salt, code
        }, false);
      } else {
        const challenge = await api(
          "/api/salt?username=" + encodeURIComponent(username), "GET", null, false
        );
        verifier = await deriveVerifier(password, challenge.salt, challenge.iterations);
        result = await api("/api/login", "POST", { username, verifier }, false);
      }
      session = result;
      localStorage.setItem(STORAGE_AUTH, JSON.stringify(session));
      document.getElementById("cloudPassword").value = "";
      document.getElementById("cloudRegistrationCode").value = "";
      const remote = await api("/api/data");
      await finishAuthorization(remote);
    } catch (error) {
      setText(error.message, true);
    } finally { setBusy(button, false); }
  });
  document.getElementById("cloudLoginTab").onclick = () => switchMode("login");
  document.getElementById("cloudRegisterTab").onclick = () => switchMode("register");
  document.getElementById("cloudMigrateCloud").onclick = () => {
    if (migrationRemote) installData(migrationRemote.data, migrationRemote.version);
  };
  document.getElementById("cloudMigrateUpload").onclick = async () => {
    if (!migrationRemote) return;
    if (migrationRemote.version > 0 && !confirm(
      "ATENÇÃO: a versão da nuvem será SUBSTITUÍDA pela cópia local. " +
      "Exporte um backup da nuvem antes, caso queira guardá-la. Continuar?"
    )) return;
    const button = document.getElementById("cloudMigrateUpload");
    button.disabled = true;
    const legacy = normalizeData(readJSON(LEGACY_KEY));
    try {
      if (migrationRemote.version > 0) {
        // Cópia preventiva da versão remota antes de uma substituição explícita.
        downloadBackup(
          migrationRemote.data || blankData(),
          "lemeone-backup-da-nuvem-antes-da-migracao.json"
        );
      }
      const result = await api("/api/data", "PUT", {
        version: migrationRemote.version, data: legacy
      });
      installData(legacy, result.version);
    } catch (error) {
      setText(error.message, true);
      if (error.status === 409 && error.payload) {
        migrationRemote = error.payload;
      }
    } finally { button.disabled = false; }
  };
  document.getElementById("cloudConflictUseCloud").onclick = () => {
    if (!conflictRemote) return;
    if (!confirm(
      "Vamos salvar um backup dos dados deste dispositivo antes de usar a versão da nuvem. Continuar?"
    )) return;
    downloadBackup(db, "lemeone-conflito-copia-local.json");
    installData(conflictRemote.data, conflictRemote.version);
  };
  document.getElementById("cloudConflictUseLocal").onclick = async () => {
    if (!conflictRemote) return;
    if (!confirm(
      "Isso vai SUBSTITUIR as alterações feitas em outro dispositivo pela versão atual deste aparelho. Continuar?"
    )) return;
    const button = document.getElementById("cloudConflictUseLocal");
    button.disabled = true;
    const snapshot = JSON.parse(JSON.stringify(db));
    try {
      const result = await api("/api/data", "PUT", {
        version: conflictRemote.version, data: snapshot
      });
      installData(snapshot, result.version);
    } catch (error) {
      setText(error.message, true);
      if (error.status === 409 && error.payload) {
        conflictRemote = error.payload;
      }
    } finally { button.disabled = false; }
  };
  document.getElementById("cloudSyncNow").onclick = async () => {
    if (conflict) return showConflict(conflictRemote);
    if (dirty) await push();
    else await pull();
    toast(dirty ? "Há alterações aguardando sincronização." : "Sincronização verificada.");
  };
  document.getElementById("cloudLogout").onclick = async () => {
    if (dirty && !confirm(
      "Existem alterações ainda NÃO enviadas. Exporte um backup antes de sair. Deseja sair mesmo assim?"
    )) return;
    if (!confirm("Deseja realmente sair da sua conta?")) return;
    clearTimeout(pushTimer);
    try { if (session?.token) await api("/api/logout", "POST"); }
    catch (error) { console.warn("Logout remoto:", error.message); }
    localStorage.removeItem(STORAGE_AUTH);
    session = null;
    active = false;
    dirty = false;
    conflict = false;
    db = blankData();
    renderAll();
    syncStatus("Não conectado");
    switchMode("login");
    showPane("auth");
  };
  window.addEventListener("online", () => {
    if (active) { if (dirty) schedulePush(0); else pull(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && active) { if (dirty) schedulePush(0); else pull(); }
  });
  window.setInterval(() => {
    if (!document.hidden && active) {
      if (dirty) schedulePush(0); else pull();
    }
  }, 45000);
  window.LemeCloud = { isActive: () => active, saveChange };
  syncStatus("Aguardando login");
  switchMode("login");
  if (!API.startsWith("https://") || API.includes("SEU-WORKER")) {
    setText("Configure o endereço do Worker no arquivo cloud-config.js antes de usar.", true);
    showPane("auth");
  } else {
    resume();
  }
})();
