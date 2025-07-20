// shop/shop-related.js
import { functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";
import { createProductTile } from "./shop-products.js";

/**
 * Render related tools based on tag overlap or bundle tags
 */
export async function renderRelatedSuggestions(product) {
  const grid = document.getElementById("relatedGrid");
  const wrapper = document.getElementById("relatedSuggestions");

  if (!grid || !wrapper) return;
  grid.innerHTML = "";

  try {
    const getProducts = httpsCallable(functions, "getFirestoreProducts");
    const res = await getProducts({ type: "Tool" });
    const products = res.data.products || [];

    const related = products
      .filter((p) =>
        p.id !== product.id &&
        p.visible !== false &&
        (p.tags?.some((tag) => product.tags?.includes(tag)) || p.tags?.includes("bundle")),
      )
      .slice(0, 3);

    if (related.length === 0) {
      wrapper.classList.add("hidden");
      return;
    }

    wrapper.classList.remove("hidden");
    related.forEach((p) => {
      const tile = createProductTile(p);
      if (tile) grid.appendChild(tile);
    });
  } catch (err) {
    console.error("Failed to load related tools:", err);
    wrapper.classList.add("hidden");
  }
}