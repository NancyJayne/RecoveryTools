// observe-admin-panels.js

/**
 * Observes visibility of admin panel DOM elements by ID
 * and lazily loads the associated JS module to run its init method.
 * Includes retry + fallback logging for robustness.
 */
const importMap = {
  "./admin/admin-products.js": () => import("../admin/admin-products.js"),
  "./admin/admin-course.js": () => import("../admin/admin-course.js"),
  "./admin/admin-workshops.js": () => import("../admin/admin-workshops.js"),
  "./admin/admin-affiliates.js": () => import("../admin/admin-affiliates.js"),
  "./admin/admin-orders.js": () => import("../admin/admin-orders.js"),
  "./admin/admin-crm.js": () => import("../admin/admin-crm.js"),
  "./admin/admin-anatoMe.js": () => import("../admin/admin-anatoMe.js"),
};

export function observeAdminPanel(tabId, importPath, methodName, maxRetries = 3) {
  const target = document.getElementById(tabId);
  if (!target) {
    console.warn(`⚠️ Panel #${tabId} not found in DOM. Skipping observer.`);
    return;
  }

  let attempts = 0;
  const observer = new MutationObserver(() => {
    if (!target.classList.contains("hidden")) {
      observer.disconnect();
      attemptLoad();
    }
  });

  observer.observe(target, { attributes: true, attributeFilter: ["class"] });

  async function attemptLoad() {
    try {
      const importer = importMap[importPath];
      if (!importer) {
        console.warn(`⚠️ No import mapping for ${importPath}`);
        return;
      }
      const mod = await importer();
      if (mod?.[methodName]) {
        mod[methodName]();
        console.info(`✅ Loaded ${methodName} from ${importPath}`);
      } else {
        console.warn(`⚠️ ${methodName} not found in ${importPath}`);
      }
    } catch (err) {
      attempts++;
      console.error(`❌ Failed to import ${importPath} (attempt ${attempts})`, err);
      if (attempts < maxRetries) {
        setTimeout(attemptLoad, 1000 * attempts); // Exponential backoff
      } else {
        console.error(`❌ Giving up after ${maxRetries} attempts to load ${importPath}`);
      }
    }
  }
}

