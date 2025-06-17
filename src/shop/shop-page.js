// src/shop/shop-page.js

import { loadProducts, showProductDetail } from "./shop-products.js";
import { setPageMeta } from "../utils/seo-utils.js";

export function initShopPage() {
  setPageMeta({
    title: "Shop | Recovery Tools",
    description: "Browse therapeutic tools and recovery gear designed by myotherapists.",
    url: "https://recoverytools.au/shop",
  });

  loadProducts();
  setupProductClickHandler();
}

function setupProductClickHandler() {
  const shopGrid = document.getElementById("shopGrid");
  if (!shopGrid) return;

  shopGrid.addEventListener("click", (e) => {
    const tile = e.target.closest("[data-product-id]");
    if (!tile) return;

    const product = JSON.parse(tile.dataset.productFull || "{}");
    if (!product?.id) return;

    showProductDetail(product);
  });
}
