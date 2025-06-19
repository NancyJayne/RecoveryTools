// homepage.js – Interactive Homepage Logic for Recovery Tools
import { showTabContent } from "../utils/utils.js";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../utils/firebase-config.js";
import { showProductDetail } from "../shop/shop-products.js";

export function initHomepage() {
  setupShopNowCTA();
  setupAffiliateCTA();
  setupBackToShopBtn();
  renderFeaturedTools();
}

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
      history.pushState({}, "", "/contact");
      showTabContent("contactSection");
      const { initContactPage } = await import("./contact.js");
      initContactPage?.();
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

  const productsRef = collection(db, "products");
  const q = query(
    productsRef,
    where("type", "==", "Tool"),
    where("tags", "array-contains", "featured"),
  );

  try {
    const querySnapshot = await getDocs(q);
    container.innerHTML = "";

    if (querySnapshot.empty) {
      const msg = document.createElement("p");
      msg.className = "text-gray-400";
      msg.textContent = "No featured tools at the moment.";
      container.appendChild(msg);
      return;
    }

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const productId = docSnap.id;

      const tile = document.createElement("div");
      tile.className =
        "bg-gray-900 p-4 rounded shadow text-center cursor-pointer hover:shadow-lg transition";
      tile.dataset.productId = productId;
      tile.dataset.productFull = JSON.stringify({ ...data, id: productId });

      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = data.images?.[0] || "/default.jpg";
      img.alt = data.name;
      img.className = "mx-auto mb-2 rounded object-cover h-40 w-full";

      const name = document.createElement("h3");
      name.className = "font-semibold text-white mb-1";
      name.textContent = data.name;

      const desc = document.createElement("p");
      desc.className = "text-sm text-gray-400";
      desc.textContent = data.shortDescription || "";

      const price = document.createElement("p");
      price.className = "text-green-400 font-bold mt-2";
      price.textContent = `$${(data.price || 0).toFixed(2)}`;

      tile.append(img, name, desc, price);
      tile.addEventListener("click", () => showProductDetail({ ...data, id: productId }));

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
