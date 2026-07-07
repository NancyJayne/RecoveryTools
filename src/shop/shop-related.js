// shop/shop-related.js
import { functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";
import { createProductTile } from "./shop-products.js";

function productTags(product) {
  return [
    ...(Array.isArray(product?.tags) ? product.tags : []),
    ...(Array.isArray(product?.tagIds) ? product.tagIds : []),
  ];
}

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
    const res = await getProducts({ type: "tool" });
    const products = res.data.products || [];
    const sourceTags = productTags(product);

    const related = products
      .filter((p) => {
        const tags = productTags(p);
        return (
          p.id !== product.id &&
          p.visible !== false &&
          (tags.some((tag) => sourceTags.includes(tag)) || tags.includes("bundle"))
        );
      })
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
