/**
 * Objeto principal de la aplicación 'Ciudad Conectada'.
 * Maneja la autenticación con JWT, llamadas a la API, sincronización offline y la lógica de la UI.
 */
window.App = {
  // --- CONFIGURACIÓN ---
  apiBaseUrl: "https://apiciudadconectada.somee.com/api",
  currentUser: null,

  // --- INICIALIZACIÓN ---
  /**
   * Registra el Service Worker, restaura la sesión del usuario y configura la lógica de la página actual.
   */
  init() {
    this.registerSW();
    this.restoreCurrentUser();
    this.setupEventListeners();
    this.setupPageSpecificLogic();

    // Escuchar mensajes del Service Worker para sincronización
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data && event.data.type === "SYNC_NOW") {
          console.log(
            "Mensaje del SW recibido, procesando cola de sincronización..."
          );
          this.processSyncQueue();
        }
      });
    }
  },

  // --- AUTENTICACIÓN Y GESTIÓN DE SESIÓN (CON JWT) ---
  /**
   * Restaura la sesión del usuario desde localStorage.
   */
  restoreCurrentUser() {
    try {
      this.currentUser = JSON.parse(localStorage.getItem("currentUser"));
    } catch (e) {
      this.currentUser = null;
    }
  },

  
async login(email, password) {
  try {
    const response = await this.apiCall("/auth/login", {
      method: "POST",
      body: { email, password },
    });

    // La API ya devuelve token + user ✔
    if (response.token && response.user) {

      // Guardamos token + datos del usuario
      localStorage.setItem("authToken", response.token);
      localStorage.setItem("currentUser", JSON.stringify(response.user));
      this.currentUser = response.user;

      this.showMessage("Inicio de sesión exitoso ✔", 2500);

      // Redirigir a Home
      setTimeout(() => window.location.href = "Home.html", 1000);
      return true;
    }

    this.showMessage("Error: Falta token o usuario en respuesta.", 3500);
    return false;

  } catch (error) {
    console.error("Error en login:", error);
    this.showMessage("Credenciales incorrectas ❌", 3000);
    return false;
  }
},


  /**
   * Registra un nuevo usuario en la API.
   * @param {object} userData - Datos del nuevo usuario.
   * @returns {Promise<object>} - Respuesta de la API.
   */
  async registerUser(userData) {
    try {
      const response = await this.apiCall("/Users", {
        method: "POST",
        body: userData,
      });

      // Registro exitoso → enviar a login
      this.showMessage("Cuenta creada correctamente. Inicia sesión.", 3000);
      setTimeout(() => (window.location.href = "Login.html"), 2000);

      return true;
    } catch (error) {
      this.showMessage("Error al registrar usuario.", 3000);
      throw error;
    }
  },

  /**
   * Guarda el token y los datos del usuario en localStorage.
   * @param {string} token - El token JWT de la API.
   * @param {object} user - El objeto con los datos del usuario.
   */
  setAuthData(token, user) {
    localStorage.setItem("authToken", token);
    localStorage.setItem("currentUser", JSON.stringify(user));
    this.currentUser = user;
  },

  /**
   * Cierra la sesión del usuario y lo redirige a la página de login.
   */
logout() {
  localStorage.removeItem("authToken");
  localStorage.removeItem("currentUser");
  this.currentUser = null;
  window.location.href = "Login.html";
},

  // --- COMUNICACIÓN CON LA API ---
  /**
   * Realiza una llamada a la API.
   * @param {string} endpoint - Endpoint de la API.
   * @param {object} options - Opciones de la petición (método, cuerpo, cabeceras).
   * @returns {Promise<object|string>} - Respuesta de la API en formato JSON o texto.
   */
  async apiCall(endpoint, options = {}) {
    const token = localStorage.getItem("authToken");
    const url = `${this.apiBaseUrl}${endpoint}`;
    const config = {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
      ...options,
    };

    if (config.body && typeof config.body !== "string") {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, config);
      if (!response.ok) {
        if (response.status === 401) this.logout();
        const errorText = await response.text();
        throw new Error(`Error en la API: ${response.status} ${errorText}`);
      }
      const contentType = response.headers.get("content-type") || "";
      return contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    } catch (error) {
      console.error("Error en apiCall:", error);
      this.showMessage(
        "Error de conexión. Revisa la consola para más detalles.",
        5000
      );
      throw error;
    }
  },

  // --- LÓGICA DE SINCRONIZACIÓN (OFFLINE-FIRST) ---
  /**
   * Guarda una acción en la cola de sincronización para ejecutarla cuando haya conexión.
   * @param {object} action - La acción a sincronizar (ej. { type: 'status-change', ... }).
   */
  enqueueSyncAction(action) {
    const queue = JSON.parse(localStorage.getItem("syncQueue") || "[]");
    queue.push({ id: Date.now(), ...action });
    localStorage.setItem("syncQueue", JSON.stringify(queue));
    this.showMessage("Acción guardada para sincronizar cuando haya conexión.");
    this.registerBackgroundSync();
  },

  /**
   * Registra un evento de sincronización en segundo plano con el Service Worker.
   */
  registerBackgroundSync() {
    if ("serviceWorker" in navigator && "SyncManager" in window) {
      navigator.serviceWorker.ready
        .then((reg) => {
          return reg.sync.register("sync-report-actions").catch(() => {
            /* No crítico */
          });
        })
        .catch(() => {
          /* No crítico */
        });
    }
  },

  /**
   * Procesa la cola de sincronización, enviando las acciones pendientes a la API.
   */
  async processSyncQueue() {
    const queue = JSON.parse(localStorage.getItem("syncQueue") || "[]");
    if (queue.length === 0) return;

    this.showMessage("Sincronizando acciones pendientes...", 3000);
    const failedActions = [];

    for (const action of queue) {
      try {
        const url = `${this.apiBaseUrl}${action.url}`;
        const config = {
          method: action.method || "POST",
          headers: { "Content-Type": "application/json" },
        };
        const token = localStorage.getItem("authToken");
        if (token) config.headers["Authorization"] = `Bearer ${token}`;
        if (action.body) config.body = JSON.stringify(action.body);

        const response = await fetch(url, config);
        if (!response.ok)
          throw new Error(
            `Falló la sincronización para la acción ${action.id}`
          );
      } catch (error) {
        console.error("Error al sincronizar la acción:", action, error);
        failedActions.push(action);
      }
    }

    // Actualiza la cola solo con las acciones que fallaron
    localStorage.setItem("syncQueue", JSON.stringify(failedActions));
    if (failedActions.length === 0) {
      this.showMessage("Sincronización completada.");
    } else {
      this.showMessage(
        "Algunas acciones no se pudieron sincronizar. Se intentará más tarde.",
        4000
      );
    }
  },

  // --- MANEJADORES DE EVENTOS Y LÓGICA DE LA UI ---
  /**
   * Configura los listeners de eventos globales (formularios, clics, etc.).
   */
  setupEventListeners() {
    document.addEventListener("submit", (e) => {
      const form = e.target;
      if (form.id === "login-form") this.handleLoginSubmit(e);
      if (form.id === "register-form") this.handleRegisterSubmit(e);
      if (form.id === "profile-form") this.handleProfileSubmit(e);
      if (form.id === "note-form") this.handleNoteSubmit(e);
    });

    document.addEventListener("click", (e) => {
      if (
        e.target.id === "change-status-button" ||
        e.target.closest("#change-status-button")
      ) {
        this.handleStatusChange();
      }
      if (e.target.matches("[data-logout]")) {
        e.preventDefault();
        this.logout();
      }
    });
  },

  checkAuthStatus() {
  const token = localStorage.getItem("authToken");
  const path = window.location.pathname;

  // Si NO hay token → enviarlo al login
  if (!token && !path.includes("Login.html") && !path.includes("RegistrarUsuario.html")) {
    window.location.href = "Login.html";
    return false;
  }

  // Si YA hay token → evitar ir a login
  if (token && (path.includes("Login.html") || path.includes("RegistrarUsuario.html"))) {
    window.location.href = "Home.html";
    return false;
  }

  return true;
},

  /**
   * Configura la lógica específica para la página actual.
   */
  setupPageSpecificLogic() {
    this.checkAuthStatus();
    const path = window.location.pathname;
    if (path.endsWith("Home.html")) this.loadReports();
    if (path.endsWith("DetalleReporte.html")) this.loadReportDetails();
    if (path.endsWith("Perfil.html")) this.loadProfile();
    if (path.endsWith("Notificaciones.html")) this.loadNotifications();
  },

  /**
   * Maneja el envío del formulario de inicio de sesión.
   */
  async handleLoginSubmit(event) {
    event.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    this.showMessage("Iniciando sesión...");
    const success = await this.login(email, password);
    if (success) {
      this.showMessage("¡Bienvenido!");
      setTimeout(() => (window.location.href = "Home.html"), 1000);
    }
  },

  /**
   * Maneja el envío del formulario de registro.
   */
  async handleRegisterSubmit(event) {
    event.preventDefault();
    const userData = {
      name: document.getElementById("name").value,
      lastName: document.getElementById("lastName").value,
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
      isAdmin: true,
      rol: document.getElementById("rol").value
    };
    this.showMessage("Creando cuenta...");
    try {
      const result = await this.registerUser(userData);
      if (result.success) {
        if (result.autoLogin) {
          this.showMessage("¡Cuenta creada e iniciada sesión!");
          setTimeout(() => (window.location.href = "Home.html"), 1000);
        } else {
          this.showMessage("¡Cuenta creada! Ahora puedes iniciar sesión.");
          setTimeout(() => (window.location.href = "Login.html"), 2000);
        }
      }
    } catch (error) {
      // El error ya se muestra en registerUser
    }
  },

  // --- FUNCIONES DE RENDERIZADO ---
async loadReports() {
  try {
    const reports = await this.apiCall("/Reports");
    const tableBody = document.getElementById("reports-table-body");
    if (!tableBody) return;

    tableBody.innerHTML = "";

    reports.forEach((report) => {
      const tipoServicio = report.service?.type || "Sin servicio";

      const row = document.createElement("tr");
      row.className = "reports-table__body-row";

      row.innerHTML = `
        <td class="reports-table__cell reports-table__cell--type">
          <span class="material-symbols-outlined text-blue-500">
            ${this.getIconForType(tipoServicio)}
          </span>
          ${this.escapeHtml(tipoServicio)}
        </td>

        <td class="reports-table__cell">
          ${this.escapeHtml(report.location || "")}
        </td>

        <td class="reports-table__cell">
          <span class="badge badge--${this.getStatusClass(report.estado)}">
            ${this.escapeHtml(report.estado)}
          </span>
        </td>

        <td class="reports-table__cell">
          ${report.createdAt ? new Date(report.createdAt).toLocaleDateString() : ""}
        </td>

        <td class="reports-table__cell reports-table__cell--link">
          <a href="DetalleReporte.html?id=${report.id}">Ver Detalles</a>
        </td>
      `;

      tableBody.appendChild(row);
    });

  } catch (error) {
    console.error("Error al cargar reportes:", error);
  }
},

  async loadReportDetails() {
  const reportId = new URLSearchParams(window.location.search).get("id");
  if (!reportId) return;

  try {
    const report = await this.apiCall(`/Reports/${reportId}`);
    if (!report) return;

    const tipoServicio = report.service?.type || "Sin servicio";

    this.setElementText(
      "report-title",
      report.service ? `${report.service.type || ""}`.trim() : "-"
    );
    this.setElementText("report-details-status", report.estado);
    this.setElementText("report-title", tipoServicio); 
    this.setElementText("report-location", report.location || "-");
    this.setElementText(
      "report-date",
      report.createdAt ? new Date(report.createdAt).toLocaleDateString() : "-"
    );
    this.setElementText(
      "report-user",
      report.user ? `${report.user.name} ${report.user.lastName || ""}`.trim() : "-"
    );
    this.setElementText("report-description", report.description || "-");

  } catch (error) {
    console.error("Error al cargar detalles del reporte:", error);
  }
},

getIconForType(type) {
  if (!type) return "help";

  const t = type.toLowerCase();

  if (t.includes("agua")) return "water_drop";
  if (t.includes("luz")) return "bolt";
  if (t.includes("infra")) return "construction";

  return "report";
},

 /* // --- FUNCIONES DE NOTAS ---

 getAuthData() {
  const user = JSON.parse(localStorage.getItem("currentUser"));
  const token = localStorage.getItem("authToken");
  return user ? { user, token } : null;
},

async handleNoteSubmit(event) {
  event.preventDefault();

  const reportId = new URLSearchParams(window.location.search).get("id");
  const content = document.getElementById("note-text").value;

  if (!content.trim()) {
    this.showMessage("La nota no puede estar vacía.");
    return;
  }

  const auth = this.getAuthData();
  if (!auth || !auth.user) {
    this.showMessage("No se encontró usuario autenticado.");
    return;
  }

  try {
    await this.apiCall(`/reports/${reportId}/notas`, {
      method: "POST",
      body: {
        userId: auth.user.id,
        description: content
      }
    });

    this.showMessage("Nota agregada correctamente.");
    document.getElementById("note-text").value = "";
    this.loadNotes(reportId);

  } catch (error) {
    console.error("Error agregando nota:", error);
    this.showMessage("Error al agregar la nota.");
  }
},

async loadNotes(reportId) {
  try {
    const notas = await this.apiCall(`/reports/${reportId}/notas`);

    const notesContainer = document.getElementById("notes-list");
    if (!notesContainer) return;

    notesContainer.innerHTML = "";

    if (!notas || notas.length === 0) {
      notesContainer.innerHTML = "<p class='no-notes'>No hay notas aún.</p>";
      return;
    }

    notas.forEach(note => {
      const div = document.createElement("div");
      div.classList.add("note-item");

      div.innerHTML = `
        <p class="note-text">${this.escapeHtml(note.description)}</p>
        <span class="note-date">${new Date(note.createdAt).toLocaleString()}</span>
      `;

      notesContainer.appendChild(div);
    });

  } catch (error) {
    console.error("Error al cargar notas:", error);
  }
},
 */

  loadProfile() {
    if (!this.currentUser) return;
    const fullname =
      `${this.currentUser.name || ""} ${
        this.currentUser.lastName || ""
      }`.trim() || "Usuario";
    this.setElementText("profile-name", fullname);
    this.setElementText("profile-email", this.currentUser.email || "");
    this.setElementText("profile-rol", this.currentUser.rol ||"");
    this.setElementValue("name", this.currentUser.name || "");
    this.setElementValue("lastName", this.currentUser.lastName || "");
    this.setElementValue("email", this.currentUser.email || "");
    this.setElementValue("rol",this.currentUser.rol || "")
  },

  loadNotifications() {
    // Aquí iría la lógica para cargar notificaciones desde localStorage o la API
    console.log("Cargando notificaciones...");
  },







  // --- FUNCIONES AUXILIARES ---
  showMessage(text, duration = 3000) {
    let messageEl = document.getElementById("app-message");
    if (!messageEl) {
      messageEl = document.createElement("div");
      messageEl.id = "app-message";
      messageEl.style.cssText =
        "position: fixed; bottom: 20px; right: 20px; z-index: 1000; background-color: #333; color: white; padding: 1rem 1.5rem; border-radius: 0.5rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transform: translateY(150%); transition: transform 0.3s ease;";
      document.body.appendChild(messageEl);
    }
    messageEl.textContent = text;
    messageEl.style.transform = "translateY(0)";
    setTimeout(
      () => (messageEl.style.transform = "translateY(150%)"),
      duration
    );
  },

  setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  },
  setElementValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  },

  escapeHtml(unsafe) {
    if (!unsafe && unsafe !== 0) return "";
    return String(unsafe).replace(/[&<>"'`=\/]/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
        "/": "&#x2F;",
        "`": "&#x60;",
        "=": "&#x3D;",
      }[c];
    });
  },

  getStatusClass(estado) {
    switch (estado) {
      case "Resuelto":
        return "resolved";
      case "En Progreso":
        return "progress";
      default:
        return "pending";
    }
  },

  // --- SERVICE WORKER ---
  registerSW() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("Service Worker registrado:", registration);
        })
        .catch((error) => {
          console.error("Error al registrar el Service Worker:", error);
        });
    }
  },
};

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
