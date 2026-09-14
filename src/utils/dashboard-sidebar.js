const STORAGE_PREFIX = "recovery-tools-dashboard-sidebar:";

function readCollapsedPreference(key) {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${key}`) === "collapsed";
  } catch {
    return false;
  }
}

function writeCollapsedPreference(key, collapsed) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, collapsed ? "collapsed" : "expanded");
  } catch {
    // The navigation still works when browser storage is unavailable.
  }
}

function setupSidebar(sidebar) {
  if (sidebar.dataset.sidebarReady === "true") return;

  const label = sidebar.dataset.sidebarLabel || "Menu";
  const storageKey = sidebar.dataset.sidebarStorageKey || label.toLowerCase();
  const content = document.createElement("div");
  content.className = "dashboard-sidebar-content";

  while (sidebar.firstChild) content.append(sidebar.firstChild);

  const header = document.createElement("div");
  header.className = "dashboard-sidebar-header";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dashboard-sidebar-toggle";
  toggle.setAttribute("aria-controls", sidebar.id);

  const applyState = (collapsed) => {
    sidebar.classList.toggle("dashboard-sidebar-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${label} menu`);
    toggle.title = `${collapsed ? "Expand" : "Collapse"} ${label} menu`;
    toggle.textContent = collapsed ? "›" : "‹";
  };

  toggle.addEventListener("click", () => {
    const collapsed = !sidebar.classList.contains("dashboard-sidebar-collapsed");
    applyState(collapsed);
    writeCollapsedPreference(storageKey, collapsed);
  });

  const title = document.createElement("span");
  title.className = "dashboard-sidebar-label";
  title.textContent = label;

  header.setAttribute("role", "heading");
  header.setAttribute("aria-level", "1");
  header.append(title, toggle);
  sidebar.append(header, content);
  sidebar.dataset.sidebarReady = "true";
  applyState(readCollapsedPreference(storageKey));
}

export function initDashboardSidebars(root = document) {
  root.querySelectorAll("[data-dashboard-sidebar]").forEach(setupSidebar);
}
