// src/content/anato-me.js

import { renderProductCatalog, setupCatalogClickHandler } from "./product-catalog.js";

export function initAnatoMePage() {
  setupCatalogClickHandler("anatoMeGrid");
  renderProductCatalog({
    gridId: "anatoMeGrid",
    type: "anato-me",
    emptyMessage: "No Anato-Me episodes found.",
    errorMessage: "Failed to load Anato-Me episodes.",
  });
}

export default initAnatoMePage;
