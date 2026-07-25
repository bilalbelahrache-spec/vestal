// Vestal admin console — deliberately plain JS with no build step or
// framework. This is a single internal tool, not part of the product
// surface the SPA build pipeline exists for; adding Vite/Preact to it
// would be real complexity for zero benefit here.

const KEY_STORAGE = "vestal_admin_key";

const els = {
  status: document.getElementById("admin-status"),
  keyInput: document.getElementById("admin-key"),
  connectBtn: document.getElementById("connect-btn"),
  statsPanel: document.getElementById("stats-panel"),
  usersPanel: document.getElementById("users-panel"),
  usersBody: document.getElementById("users-body"),
};

function adminKey() {
  return sessionStorage.getItem(KEY_STORAGE) || "";
}

async function adminFetch(path, init) {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init && init.headers), authorization: `Bearer ${adminKey()}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request failed (${res.status})`);
  }
  return res.status === 204 ? undefined : res.json();
}

function fmtDate(unixSeconds) {
  if (unixSeconds === null || unixSeconds === undefined) return "never";
  return new Date(unixSeconds * 1000).toLocaleString();
}

function renderStats(stats) {
  document.getElementById("stat-users").textContent = stats.total_users;
  document.getElementById("stat-checks").textContent = stats.total_checks;
  document.getElementById("stat-channels").textContent = stats.total_alert_channels;
  document.getElementById("stat-active").textContent = stats.active_last_24h;
  document.getElementById("stat-unverified").textContent = stats.unverified_email_count;
  els.statsPanel.hidden = false;
}

function renderUsers(users) {
  els.usersBody.innerHTML = "";
  for (const u of users) {
    const tr = document.createElement("tr");

    const cells = [
      u.email,
      fmtDate(u.created_at),
      u.email_verified ? "yes" : "no",
      u.totp_enabled ? "yes" : "no",
      String(u.check_count),
      String(u.alert_channel_count),
      fmtDate(u.last_ping_at),
    ];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (i === 2 || i === 3) td.className = text === "yes" ? "yes" : "no";
      tr.appendChild(td);
    });

    const actionTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteUser(u.id, u.email, tr));
    actionTd.appendChild(delBtn);
    tr.appendChild(actionTd);

    els.usersBody.appendChild(tr);
  }
  els.usersPanel.hidden = false;
}

async function deleteUser(id, email, row) {
  if (!confirm(`Permanently delete ${email}? This removes every check, ping, and alert channel they own.`)) {
    return;
  }
  try {
    await adminFetch(`/api/admin/users/${id}`, { method: "DELETE" });
    row.remove();
    els.status.textContent = `Deleted ${email}.`;
  } catch (err) {
    els.status.textContent = `Couldn't delete ${email}: ${err.message}`;
  }
}

async function loadAll() {
  els.status.textContent = "Loading…";
  try {
    const [stats, users] = await Promise.all([
      adminFetch("/api/admin/stats"),
      adminFetch("/api/admin/users"),
    ]);
    renderStats(stats);
    renderUsers(users);
    els.status.textContent = `Connected — ${users.length} accounts.`;
  } catch (err) {
    els.statsPanel.hidden = true;
    els.usersPanel.hidden = true;
    els.status.textContent = `Couldn't load: ${err.message}`;
    if (err.message === "unauthorized") sessionStorage.removeItem(KEY_STORAGE);
  }
}

els.connectBtn.addEventListener("click", () => {
  const key = els.keyInput.value.trim();
  if (!key) return;
  sessionStorage.setItem(KEY_STORAGE, key);
  loadAll();
});
els.keyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.connectBtn.click();
});

if (adminKey()) {
  els.keyInput.value = adminKey();
  loadAll();
}
