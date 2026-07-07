// src/content/programs.js

import { renderProductCatalog, setupCatalogClickHandler } from "./product-catalog.js";

export function initProgramsPage() {
  setupCatalogClickHandler("programGrid");
  renderProductCatalog({
    gridId: "programGrid",
    type: "program",
    emptyMessage: "No programs found.",
    errorMessage: "Failed to load programs.",
  });
}

export default initProgramsPage;
