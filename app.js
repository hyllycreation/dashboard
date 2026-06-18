// ============================================
// INIT SUPABASE
// ============================================
// Le SDK UMD du CDN s'expose sous window.supabase. On le capture sous un autre
// nom AVANT de réutiliser le binding, sinon WebKit (Safari) lève
// "Can't create duplicate variable that shadows a global property: 'supabase'".
const supabaseSDK = window.supabase;

// `var` (et non let/const) réutilise la propriété globale existante sans la
// shadower — on peut donc garder le nom `supabase` partout dans le fichier.
var supabase = null;
let initError = null;

if (!supabaseSDK || typeof supabaseSDK.createClient !== "function") {
  initError = "Le SDK Supabase n'a pas pu être chargé. Vérifiez votre connexion internet ou désactivez un éventuel bloqueur de pub, puis rechargez la page.";
  console.error("[INIT] window.supabase est introuvable — le script CDN n'a pas chargé.");
} else if (!SUPABASE_URL || SUPABASE_URL.includes("VOTRE_PROJET") || !SUPABASE_ANON_KEY) {
  initError = "Configuration Supabase manquante (URL ou clé). Vérifiez config.js.";
  console.error("[INIT] SUPABASE_URL ou SUPABASE_ANON_KEY non configuré.");
} else {
  try {
    supabase = supabaseSDK.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    initError = "Impossible d'initialiser Supabase : " + e.message;
    console.error("[INIT]", e);
  }
}

const STATUTS = ["prospect", "devis_envoye", "en_cours", "en_revision", "livre", "vendu"];
const STATUT_LABELS = {
  prospect: "Prospect",
  devis_envoye: "Devis envoyé",
  en_cours: "En cours",
  en_revision: "En révision",
  livre: "Livré",
  vendu: "Vendu"
};

let allProjects = [];
let allClients = [];
let currentView = "kanban"; // "kanban" | "list"
let currentUserEmail = null;

// ============================================
// AUTH
// ============================================
const loginScreen = document.getElementById("login-screen");
const appEl = document.getElementById("app");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const loginBtn = document.getElementById("login-btn");

async function checkSession() {
  if (!supabase) {
    showLogin();
    loginError.textContent = initError || "Erreur d'initialisation.";
    return;
  }
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      currentUserEmail = data.session.user.email;
      showApp();
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin();
    loginError.textContent = "Erreur réseau : impossible de joindre Supabase.";
    console.error("[checkSession]", err);
  }
}

function showLogin() {
  loginScreen.classList.remove("hidden");
  appEl.classList.add("hidden");
}

function showApp() {
  loginScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  loadAll();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  loginBtn.disabled = true;
  loginBtn.textContent = "Connexion...";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!supabase) {
    loginError.textContent = initError || "Supabase non initialisé.";
    loginBtn.disabled = false;
    loginBtn.textContent = "Se connecter";
    return;
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      loginError.textContent = "Email ou mot de passe incorrect. (" + error.message + ")";
      return;
    }
    currentUserEmail = data.user.email;
    showApp();
  } catch (err) {
    loginError.textContent = "Erreur réseau : impossible de joindre Supabase.";
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Se connecter";
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  showLogin();
});

// ============================================
// CHARGEMENT DES DONNEES
// ============================================
async function loadAll() {
  await Promise.all([loadClients(), loadProjects()]);
  render();
}

async function loadClients() {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("nom", { ascending: true });
  if (error) return showToast("Erreur chargement clients: " + error.message, "error");
  allClients = data || [];
}

async function loadProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("*, clients(id, nom, entreprise, email, telephone)")
    .order("created_at", { ascending: false });
  if (error) return showToast("Erreur chargement projets: " + error.message, "error");
  allProjects = data || [];
}

// ============================================
// RENDU
// ============================================
function getFilteredProjects() {
  const search = document.getElementById("search").value.trim().toLowerCase();
  const responsable = document.getElementById("filter-responsable").value;

  return allProjects.filter((p) => {
    if (responsable && p.responsable !== responsable) return false;
    if (search) {
      const haystack = [
        p.nom,
        p.clients?.nom,
        p.clients?.entreprise,
        p.notes
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function render() {
  renderStats();
  const filtered = getFilteredProjects();

  const emptyState = document.getElementById("empty-state");
  const kanbanView = document.getElementById("kanban-view");
  const listView = document.getElementById("list-view");

  if (allProjects.length === 0) {
    emptyState.classList.remove("hidden");
    kanbanView.classList.add("hidden");
    listView.classList.add("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  if (currentView === "kanban") {
    kanbanView.classList.remove("hidden");
    listView.classList.add("hidden");
    renderKanban(filtered);
  } else {
    kanbanView.classList.add("hidden");
    listView.classList.remove("hidden");
    renderList(filtered);
  }
}

function renderStats() {
  const total = allProjects.length;
  const vendus = allProjects.filter(p => p.statut === "vendu").length;
  const enCours = allProjects.filter(p => p.statut === "en_cours").length;
  const ca = allProjects
    .filter(p => p.statut === "vendu")
    .reduce((sum, p) => sum + (Number(p.montant) || 0), 0);

  document.getElementById("stats-bar").innerHTML = `
    <div class="stat"><div class="stat-value">${total}</div><div class="stat-label">Sites au total</div></div>
    <div class="stat"><div class="stat-value">${enCours}</div><div class="stat-label">En cours</div></div>
    <div class="stat"><div class="stat-value">${vendus}</div><div class="stat-label">Vendus</div></div>
    <div class="stat"><div class="stat-value">${ca.toLocaleString("fr-FR")}</div><div class="stat-label">CA vendu (€/CHF)</div></div>
  `;
}

function renderKanban(projects) {
  STATUTS.forEach(statut => {
    const col = document.querySelector(`.kanban-cards[data-statut="${statut}"]`);
    const items = projects.filter(p => p.statut === statut);
    col.innerHTML = items.map(p => cardHTML(p)).join("") ||
      `<div style="padding:16px;text-align:center;color:var(--text-faint);font-size:13px;">Vide</div>`;
  });

  // Attach drag events + click events
  document.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", () => openDetail(card.dataset.id));
    card.addEventListener("dragstart", onDragStart);
    card.addEventListener("dragend", onDragEnd);
  });
}

function cardHTML(p) {
  const clientLabel = p.clients ? (p.clients.entreprise || p.clients.nom) : "—";
  const echeance = p.date_echeance ? formatDate(p.date_echeance) : "";
  const montant = p.montant ? Number(p.montant).toLocaleString("fr-FR") + " " : "";
  return `
    <div class="card" draggable="true" data-id="${p.id}">
      <div class="card-title">${escapeHTML(p.nom)}</div>
      <div class="card-client">${escapeHTML(clientLabel)}</div>
      <div class="card-footer">
        <span>${p.responsable ? `<span class="card-badge">${escapeHTML(p.responsable)}</span>` : ""}</span>
        <span>
          ${montant ? `<span class="card-amount">${montant}</span>` : ""}
          ${echeance ? ` · ${echeance}` : ""}
        </span>
      </div>
    </div>
  `;
}

function renderList(projects) {
  const tbody = document.getElementById("list-body");
  tbody.innerHTML = projects.map(p => {
    const clientLabel = p.clients ? (p.clients.entreprise || p.clients.nom) : "—";
    const montant = p.montant ? Number(p.montant).toLocaleString("fr-FR") : "—";
    const echeance = p.date_echeance ? formatDate(p.date_echeance) : "—";
    const urlLink = p.url ? `<a href="${escapeAttr(p.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--accent);text-decoration:none;">↗</a>` : "";
    return `
      <tr data-id="${p.id}">
        <td class="cell-title" data-label="Site">${escapeHTML(p.nom)} ${urlLink}</td>
        <td data-label="Client">${escapeHTML(clientLabel)}</td>
        <td data-label="Statut"><span class="status-tag ${p.statut}"><span class="dot dot-${p.statut}"></span>${STATUT_LABELS[p.statut]}</span></td>
        <td data-label="Responsable">${escapeHTML(p.responsable || "—")}</td>
        <td data-label="Montant">${montant}</td>
        <td data-label="Échéance">${echeance}</td>
        <td class="cell-chevron">›</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("click", () => openDetail(tr.dataset.id));
  });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) {
  return escapeHTML(str);
}

// ============================================
// DRAG & DROP (changer le statut)
// ============================================
let draggedId = null;

function onDragStart(e) {
  draggedId = e.target.dataset.id;
  e.target.classList.add("dragging");
}
function onDragEnd(e) {
  e.target.classList.remove("dragging");
}

document.querySelectorAll(".kanban-cards").forEach(col => {
  col.addEventListener("dragover", (e) => {
    e.preventDefault();
    col.classList.add("drag-over");
  });
  col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
  col.addEventListener("drop", async (e) => {
    e.preventDefault();
    col.classList.remove("drag-over");
    const newStatut = col.dataset.statut;
    if (!draggedId) return;
    await updateProjectStatut(draggedId, newStatut);
  });
});

async function updateProjectStatut(projectId, newStatut) {
  const project = allProjects.find(p => p.id === projectId);
  if (!project || project.statut === newStatut) return;

  const oldStatut = project.statut;

  const { error } = await supabase
    .from("projects")
    .update({ statut: newStatut })
    .eq("id", projectId);

  if (error) return showToast("Erreur: " + error.message, "error");

  // log history
  await supabase.from("project_history").insert({
    project_id: projectId,
    ancien_statut: oldStatut,
    nouveau_statut: newStatut,
    auteur: currentUserEmail
  });

  project.statut = newStatut;
  render();
  showToast(`"${project.nom}" → ${STATUT_LABELS[newStatut]}`, "success");
}

// ============================================
// VIEW TOGGLE
// ============================================
document.getElementById("view-toggle").addEventListener("click", () => {
  currentView = currentView === "kanban" ? "list" : "kanban";
  document.getElementById("view-toggle").textContent = currentView === "kanban" ? "☰ Liste" : "▦ Kanban";
  render();
});

// ============================================
// FILTRES / RECHERCHE
// ============================================
document.getElementById("search").addEventListener("input", render);
document.getElementById("filter-responsable").addEventListener("change", render);

// ============================================
// MODAL DETAIL (lecture seule)
// ============================================
const detailModal = document.getElementById("detail-modal");
let currentDetailId = null;

function detailRow(label, valueHTML) {
  if (valueHTML === "" || valueHTML == null) return "";
  return `<div class="detail-row"><dt>${label}</dt><dd>${valueHTML}</dd></div>`;
}

function openDetail(projectId) {
  const p = allProjects.find(pr => pr.id === projectId);
  if (!p) return;
  currentDetailId = projectId;

  // En-tête
  document.getElementById("detail-title").textContent = p.nom || "—";
  const statusEl = document.getElementById("detail-status");
  statusEl.className = "detail-status status-tag " + p.statut;
  statusEl.innerHTML = `<span class="dot dot-${p.statut}"></span>${STATUT_LABELS[p.statut] || p.statut}`;

  // Corps
  const client = p.clients ? (p.clients.entreprise || p.clients.nom) : null;
  const contact = p.clients && p.clients.entreprise && p.clients.nom && p.clients.entreprise !== p.clients.nom
    ? p.clients.nom : null;
  const email = p.clients && p.clients.email ? p.clients.email : null;
  const tel = p.clients && p.clients.telephone ? p.clients.telephone : null;
  const montant = p.montant ? Number(p.montant).toLocaleString("fr-FR") + " €/CHF" : null;
  const debut = p.date_debut ? formatDate(p.date_debut) : null;
  const echeance = p.date_echeance ? formatDate(p.date_echeance) : null;

  document.getElementById("detail-body").innerHTML =
    detailRow("Client", client ? escapeHTML(client) : "—") +
    detailRow("Contact", contact ? escapeHTML(contact) : "") +
    detailRow("Email", email ? `<a href="mailto:${escapeAttr(email)}">${escapeHTML(email)}</a>` : "") +
    detailRow("Téléphone", tel ? escapeHTML(tel) : "") +
    detailRow("Responsable", p.responsable ? escapeHTML(p.responsable) : "—") +
    detailRow("Montant", montant ? `<span class="detail-amount">${montant}</span>` : "—") +
    detailRow("Date de début", debut || "—") +
    detailRow("Échéance", echeance || "—") +
    detailRow("Lien", p.url ? `<a href="${escapeAttr(p.url)}" target="_blank" rel="noopener">${escapeHTML(p.url)}</a>` : "—") +
    detailRow("Notes", p.notes ? escapeHTML(p.notes).replace(/\n/g, "<br>") : "—");

  // Bouton "Ouvrir le site"
  const openBtn = document.getElementById("detail-open");
  if (p.url) {
    openBtn.href = p.url;
    openBtn.classList.remove("hidden");
  } else {
    openBtn.classList.add("hidden");
  }

  detailModal.classList.remove("hidden");
}

function closeDetail() {
  detailModal.classList.add("hidden");
  currentDetailId = null;
}

document.getElementById("detail-close").addEventListener("click", closeDetail);
detailModal.addEventListener("click", (e) => { if (e.target === detailModal) closeDetail(); });

document.getElementById("detail-edit").addEventListener("click", () => {
  const id = currentDetailId;
  closeDetail();
  openModal(id);
});

document.getElementById("detail-delete").addEventListener("click", async () => {
  const id = currentDetailId;
  if (!id) return;
  if (!confirm("Supprimer ce site définitivement ?")) return;

  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return showToast("Erreur: " + error.message, "error");

  closeDetail();
  await loadAll();
  showToast("Site supprimé.", "success");
});

// ============================================
// MODAL PROJET
// ============================================
const modal = document.getElementById("project-modal");
const projectForm = document.getElementById("project-form");
const modalTitle = document.getElementById("modal-title");
const deleteBtn = document.getElementById("delete-project-btn");
const clientSelect = document.getElementById("p-client-select");
const newClientBlock = document.getElementById("new-client-block");

function populateClientSelect(selectedId) {
  clientSelect.innerHTML = `<option value="">— Aucun —</option>` +
    allClients.map(c => `<option value="${c.id}">${escapeHTML(c.entreprise || c.nom)}</option>`).join("") +
    `<option value="__new__">+ Créer un nouveau client</option>`;
  clientSelect.value = selectedId || "";
}

clientSelect.addEventListener("change", () => {
  if (clientSelect.value === "__new__") {
    newClientBlock.classList.remove("hidden");
  } else {
    newClientBlock.classList.add("hidden");
  }
});

function openModal(projectId) {
  projectForm.reset();
  newClientBlock.classList.add("hidden");

  if (projectId) {
    const p = allProjects.find(pr => pr.id === projectId);
    modalTitle.textContent = "Modifier le site";
    deleteBtn.classList.remove("hidden");

    document.getElementById("project-id").value = p.id;
    document.getElementById("p-nom").value = p.nom || "";
    document.getElementById("p-statut").value = p.statut;
    document.getElementById("p-responsable").value = p.responsable || "";
    document.getElementById("p-montant").value = p.montant || "";
    document.getElementById("p-debut").value = p.date_debut || "";
    document.getElementById("p-echeance").value = p.date_echeance || "";
    document.getElementById("p-url").value = p.url || "";
    document.getElementById("p-notes").value = p.notes || "";

    populateClientSelect(p.client_id);
  } else {
    modalTitle.textContent = "Nouveau site";
    deleteBtn.classList.add("hidden");
    document.getElementById("project-id").value = "";
    populateClientSelect("");
  }

  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
}

document.getElementById("new-project-btn").addEventListener("click", () => openModal(null));
document.getElementById("empty-add-btn").addEventListener("click", () => openModal(null));
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("cancel-btn").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

// SAVE
projectForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById("save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Enregistrement...";

  try {
    let clientId = clientSelect.value;

    // Créer un nouveau client si nécessaire
    if (clientId === "__new__") {
      const nom = document.getElementById("c-nom").value.trim();
      if (!nom) {
        showToast("Le nom du client est requis.", "error");
        return;
      }
      const { data, error } = await supabase.from("clients").insert({
        nom,
        entreprise: document.getElementById("c-entreprise").value.trim() || null,
        email: document.getElementById("c-email").value.trim() || null
      }).select().single();

      if (error) { showToast("Erreur création client: " + error.message, "error"); return; }
      allClients.push(data);
      clientId = data.id;
    }
    if (clientId === "") clientId = null;

    const projectId = document.getElementById("project-id").value;
    const payload = {
      nom: document.getElementById("p-nom").value.trim(),
      client_id: clientId,
      statut: document.getElementById("p-statut").value,
      responsable: document.getElementById("p-responsable").value || null,
      montant: document.getElementById("p-montant").value || null,
      date_debut: document.getElementById("p-debut").value || null,
      date_echeance: document.getElementById("p-echeance").value || null,
      url: document.getElementById("p-url").value.trim() || null,
      notes: document.getElementById("p-notes").value.trim() || null
    };

    if (projectId) {
      // Update — log history if statut changed
      const oldProject = allProjects.find(p => p.id === projectId);
      const { error } = await supabase.from("projects").update(payload).eq("id", projectId);
      if (error) { showToast("Erreur: " + error.message, "error"); return; }

      if (oldProject.statut !== payload.statut) {
        await supabase.from("project_history").insert({
          project_id: projectId,
          ancien_statut: oldProject.statut,
          nouveau_statut: payload.statut,
          auteur: currentUserEmail
        });
      }
      showToast("Site mis à jour.", "success");
    } else {
      const { error } = await supabase.from("projects").insert(payload);
      if (error) { showToast("Erreur: " + error.message, "error"); return; }
      showToast("Site créé.", "success");
    }

    closeModal();
    await loadAll();
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Enregistrer";
  }
});

// DELETE
deleteBtn.addEventListener("click", async () => {
  const projectId = document.getElementById("project-id").value;
  if (!projectId) return;
  if (!confirm("Supprimer ce site définitivement ?")) return;

  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) return showToast("Erreur: " + error.message, "error");

  closeModal();
  await loadAll();
  showToast("Site supprimé.", "success");
});

// ============================================
// TOAST
// ============================================
let toastTimeout;
function showToast(message, type = "") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "toast" + (type ? " " + type : "");
  toast.classList.remove("hidden");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add("hidden"), 3000);
}

// ============================================
// INIT
// ============================================
checkSession();
