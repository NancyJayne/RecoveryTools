// homepage.js – Interactive Homepage Logic for Recovery Tools
import { showTabContent } from "../utils/utils.js";
import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";
import { showProductDetail } from "../shop/shop-products.js";
import { productTypeLabel } from "../shop/shop-products.js";

function productTags(product) {
  return [
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.tagIds) ? product.tagIds : []),
  ].map((tag) => String(tag).toLowerCase());
}

function isFeatured(product) {
  return product.featured === true || productTags(product).includes("featured");
}

export function initHomepage() {
  setupShopNowCTA();
  setupAffiliateCTA();
  setupBackToShopBtn();
  renderFeaturedTools();
}

// Provide default export so dynamic imports auto-run initialization
export default initHomepage;

function setupShopNowCTA() {
  const shopCTA = document.getElementById("shopNowBtn");
  if (shopCTA) {
    shopCTA.addEventListener("click", async (e) => {
      e.preventDefault();
      history.pushState({}, "", "/shop");
      showTabContent("shopSection");
      const { initShopPage } = await import("../shop/shop-page.js");
      initShopPage?.();
    });
  }
}

function setupAffiliateCTA() {
  const affiliateBtn = document.getElementById("ctaAffiliateBtn");
  if (affiliateBtn) {
    affiliateBtn.addEventListener("click", async () => {
      history.pushState({}, "", "/affiliateSignup");
      showTabContent("affiliateWhySection");
      const { initAffiliateSignup } = await import("../affiliate/affiliate-signup.js");
      initAffiliateSignup?.();
    });
  }
}

function setupBackToShopBtn() {
  const backToShopBtn = document.getElementById("backToShopBtn");
  if (backToShopBtn) {
    backToShopBtn.addEventListener("click", async () => {
      history.pushState({}, "", "/shop");
      showTabContent("shopSection");
      const { initShopPage } = await import("../shop/shop-page.js");
      initShopPage?.();
    });
  }
}

async function renderFeaturedTools() {
  const container = document.getElementById("featuredToolsGrid");
  if (!container) return;

  try {
    const getProducts = httpsCallable(functions, "getFirestoreProducts");
    const res = await getProducts({});
    const products = (Array.isArray(res.data?.products) ? res.data.products : [])
      .filter(isFeatured)
      .slice(0, 4);

    container.innerHTML = "";

    if (products.length === 0) {
      const msg = document.createElement("p");
      msg.className = "text-gray-400";
      msg.textContent = "No featured tools at the moment.";
      container.appendChild(msg);
      return;
    }

    products.forEach((data) => {
      const tile = document.createElement("div");
      tile.className =
        "relative bg-gray-900 p-4 rounded shadow text-center cursor-pointer hover:shadow-lg transition";
      tile.dataset.productId = data.id;
      tile.dataset.productFull = JSON.stringify(data);

      const typeBadge = document.createElement("span");
      typeBadge.className = "absolute right-2 top-2 rounded bg-[#407471] px-2 py-1 text-xs font-semibold text-white";
      typeBadge.textContent = productTypeLabel(data);

      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = data.image || data.images?.[0] || "/default.jpg";
      img.alt = data.name || data.title || "Featured product";
      img.className = "mx-auto mb-2 rounded object-cover h-40 w-full";

      const name = document.createElement("h3");
      name.className = "font-semibold text-white mb-1";
      name.textContent = data.name || data.title || "Product";

      const desc = document.createElement("p");
      desc.className = "text-sm text-gray-400";
      desc.textContent = data.shortDescription || data.description || "";

      const price = document.createElement("p");
      price.className = "text-green-400 font-bold mt-2";
      price.textContent = `$${Number(data.price ?? data.priceFrom ?? 0).toFixed(2)}`;

      tile.append(typeBadge, img, name, desc, price);
      tile.addEventListener("click", () => showProductDetail(data));

      container.appendChild(tile);
    });
  } catch (error) {
    console.error("Failed to load featured tools:", error);
    container.innerHTML = "";

    const msg = document.createElement("p");
    msg.className = "text-red-400";
    msg.textContent = "Failed to load tools.";
    container.appendChild(msg);
  }
}
