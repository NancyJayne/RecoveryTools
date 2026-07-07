import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";
import { createProductTile, showProductDetail } from "../shop/shop-products.js";

function spinner() {
  const wrapper = document.createElement("div");
  wrapper.className = "flex justify-center items-center min-h-[200px]";

  const loader = document.createElement("div");
  loader.className =
    "w-12 h-12 border-4 border-t-4 border-gray-500 border-t-transparent rounded-full animate-spin";

  wrapper.appendChild(loader);
  return wrapper;
}

function message(text, className = "text-gray-400") {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = text;
  return element;
}

export async function renderProductCatalog({
  gridId,
  type,
  emptyMessage,
  errorMessage,
}) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  grid.textContent = "";
  grid.appendChild(spinner());

  try {
    const getProducts = httpsCallable(functions, "getFirestoreProducts");
    const res = await getProducts({ type });
    const products = Array.isArray(res.data?.products) ? res.data.products : [];

    grid.textContent = "";

    if (products.length === 0) {
      grid.appendChild(message(emptyMessage));
      return;
    }

    products.forEach((product) => {
      const tile = createProductTile(product);
      if (tile) grid.appendChild(tile);
    });
  } catch (error) {
    console.error(`Failed to load ${type} catalog:`, error);
    grid.textContent = "";
    grid.appendChild(message(errorMessage, "text-red-500"));
  }
}

export function setupCatalogClickHandler(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid || grid.dataset.catalogClickReady === "true") return;

  grid.dataset.catalogClickReady = "true";
  grid.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-product-id]");
    if (!tile) return;

    const product = JSON.parse(tile.dataset.productFull || "{}");
    if (!product?.id) return;

    showProductDetail(product);
  });
}
