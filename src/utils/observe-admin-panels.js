// observe-admin-panels.js

/**
 * Observes visibility of admin panel DOM elements by ID
 * and lazily loads the associated JS module to run its init method.
 * Includes retry + fallback logging for robustness.
 */
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
      const mod = await import(/* @vite-ignore */ importPath);
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

