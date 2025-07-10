// Load/display product catalog
// src/shop/shop-products.js

import { functions } from "../utils/firebase-config.js";
import { logClientError } from "../utils/logClientError.js";
import { renderProductReviews, setupReviewForm } from "./shop-reviews.js";
import { renderRelatedSuggestions } from "./shop-related.js";
import { addToCart } from "./shop-cart.js";
import { setPageMeta } from "../utils/seo-utils.js";
import { showToast } from "../utils/utils.js";


export async function loadProducts() {
  const shopGrid = document.getElementById("shopGrid");
  if (!shopGrid) return;

  shopGrid.innerHTML = `
    <div class="flex justify-center items-center min-h-[200px]">
      <div class="w-12 h-12 border-4 border-t-4 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  `;

  try {
    const getProducts = functions.httpsCallable("getFirestoreProducts");
    const res = await getProducts({ type: "Tool" });
    const products = Array.isArray(res.data?.products) ? res.data.products : [];


    shopGrid.innerHTML = "";

    if (products.length === 0) {
      shopGrid.innerHTML = `<p class="text-gray-400">No tools available.</p>`;
      return;
    }

    products.forEach((product) => {
      const tile = createProductTile(product);
      if (tile) shopGrid.appendChild(tile);
    });

  } catch (error) {
    console.error("Error loading products:", error);
    shopGrid.innerHTML = `<p class="text-red-500">Failed to load products. Try refreshing.</p>`;
    showToast("Failed to load products.", "error");

    await logClientError({
      message: error.message,
      stack: error.stack,
      action: "loadProducts",
      metadata: { function: "getFirestoreProducts", location: "shop-products.js" },
    });
  }
}

export function createProductTile(product) {
  if (product.visible === false) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "relative bg-gray-800 p-4 rounded-lg shadow hover:ring-2 hover:ring-[#407471]";
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute("tabindex", "0");
  wrapper.setAttribute(
    "aria-label",
    `View details for ${product.name || product.title}`,
  );
  wrapper.setAttribute("aria-pressed", "false");
  wrapper.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      wrapper.click();
    }
  });

  wrapper.dataset.productId = product.id;
  wrapper.dataset.productName = product.name || product.title;
  wrapper.dataset.productPrice = product.price;
  wrapper.dataset.productImage = product.images?.[0] || product.image || "";
  wrapper.dataset.productDescription = product.shortDescription;
  wrapper.dataset.productStock = product.stock;
  wrapper.dataset.productFull = JSON.stringify(product);

  if (product.tags?.includes("featured")) {
    const badge = document.createElement("span");
    badge.textContent = "★ Featured";
    badge.className = "absolute top-2 left-2 bg-yellow-500 text-black text-xs px-2 py-1 rounded";
    wrapper.appendChild(badge);
  }

  const image = document.createElement("img");
  image.src =
    product.images?.[0] ||
    product.image ||
    "https://via.placeholder.com/300x300?text=Product";
  image.alt = product.name || product.title;
  image.className = "w-full h-48 object-cover rounded";

  const name = document.createElement("h3");
  name.textContent = product.name || product.title;
  name.className = "text-lg font-semibold mt-2 text-white";

  const shortDesc = document.createElement("p");
  shortDesc.textContent = product.shortDescription || "";
  shortDesc.className = "text-sm text-gray-300 mt-1";

  const finalPrice =
  product.onSale && product.salePrice ? product.salePrice : product.price;

  const price = document.createElement("p");
  price.innerHTML =
  product.onSale && product.salePrice
    ? `<span class="line-through text-gray-500 mr-2">
         $${(product.price / 100).toFixed(2)}
       </span><span class="text-green-400 font-bold">
         $${(finalPrice / 100).toFixed(2)}
       </span>`
    : `$${(finalPrice / 100).toFixed(2)}`;

  price.className = "mt-1";

  wrapper.appendChild(image);
  wrapper.appendChild(name);
  wrapper.appendChild(shortDesc);
  wrapper.appendChild(price);

  if (product.stock === 0) {
    const overlay = document.createElement("div");
    overlay.className = "absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center rounded";
    overlay.innerHTML = `<span class="text-white font-semibold text-lg">Out of Stock</span>`;
    wrapper.appendChild(overlay);
  }

  return wrapper;
}

export function showProductDetail(product) {
  const detail = document.getElementById("productDetailContainer");
  if (detail.dataset.currentId === product.id) return;

  detail.dataset.currentId = product.id;
  detail.innerHTML = "";

  // 🧭 Breadcrumb Back to Shop
  const breadcrumb = document.getElementById("breadcrumbBackLink");
  if (breadcrumb) {
    breadcrumb.onclick = (e) => {
      e.preventDefault();
      showTabContent("shopSection");
      history.pushState({}, "", "/shop");
      setTimeout(() => {
        const grid = document.getElementById("shopGrid");
        if (grid) grid.scrollIntoView({ behavior: "smooth" });
      }, 100);
    };
  }

  const wrapper = document.createElement("div");
  wrapper.className = "flex flex-col md:flex-row gap-10 items-start px-4 sm:px-6 md:px-8 max-w-screen-xl mx-auto";

  const img = document.createElement("img");
  img.src =
    product.images?.[0] ||
    product.image ||
    "https://via.placeholder.com/400x400";
  img.alt = product.name || product.title;
  img.className = "w-full h-auto max-h-[400px] object-cover rounded md:max-w-[600px]";

  const content = document.createElement("div");
  content.className = "flex flex-col md:w-1/2 px-4";

  const title = document.createElement("h2");
  title.textContent = product.name || product.title;
  title.className = "text-2xl font-bold mb-2";

  const price = document.createElement("span");
  const finalPrice =
  product.onSale && product.salePrice ? product.salePrice : product.price;

  price.innerHTML =
  product.onSale && product.salePrice
    ? `<span class="line-through text-gray-500 mr-2">
         $${(product.price / 100).toFixed(2)}
       </span><span class="text-green-400 font-bold">
         $${(finalPrice / 100).toFixed(2)}
       </span>`
    : `$${(finalPrice / 100).toFixed(2)}`;

  price.className = "text-green-400 text-xl font-bold mb-2";


  const shortDesc = document.createElement("p");
  shortDesc.textContent = product.shortDescription;
  shortDesc.className = "text-sm text-gray-300 mb-2";

  const longDesc = document.createElement("p");
  longDesc.textContent = product.longDescription;
  longDesc.className = "text-sm text-gray-400 mb-4";

  const featureList = document.createElement("ul");
  featureList.className = "list-disc ml-5 text-sm text-gray-300 mb-4";
  (product.features || []).forEach((f) => {
    const li = document.createElement("li");
    li.textContent = f;
    featureList.appendChild(li);
  });

  const priceWrap = document.createElement("div");
  priceWrap.className = "flex flex-col gap-4 mb-4";

  const qtyWrap = document.createElement("div");
  qtyWrap.className = "flex items-center gap-4";

  const minusBtn = document.createElement("button");
  minusBtn.textContent = "-";
  minusBtn.className = "bg-gray-700 text-white w-8 h-8 rounded text-lg";

  const qtyDisplay = document.createElement("span");
  qtyDisplay.textContent = "1";
  qtyDisplay.className = "text-white font-semibold w-8 text-center select-none";

  const plusBtn = document.createElement("button");
  plusBtn.textContent = "+";
  plusBtn.className = "bg-gray-700 text-white w-8 h-8 rounded text-lg";

  let quantity = 1;
  minusBtn.onclick = () => {
    if (quantity > 1) {
      quantity--;
      qtyDisplay.textContent = quantity;
    }
  };
  plusBtn.onclick = () => {
    quantity++;
    qtyDisplay.textContent = quantity;
  };

  qtyWrap.appendChild(minusBtn);
  qtyWrap.appendChild(qtyDisplay);
  qtyWrap.appendChild(plusBtn);

  const btn = document.createElement("button");
  btn.className = "bg-[#407471] text-white px-4 py-2 rounded w-fit";
  btn.textContent = product.stock === 0 ? "Out of Stock" : "Add to Cart";
  btn.disabled = product.stock === 0;
  if (!btn.disabled) {
    btn.addEventListener("click", () => {
      addToCart({
        id: product.id,
        name: product.name || product.title,
        price: finalPrice,
        quantity,
        type: product.type || "tool",
        creatorId: product.creatorId,
        affiliatePercent: product.affiliatePercent,
        image: product.images?.[0] || product.image,
      });
    });

  } else {
    btn.classList.add("opacity-50", "cursor-not-allowed");
  }

  priceWrap.appendChild(qtyWrap);
  priceWrap.appendChild(btn);

  const backBtn = document.createElement("button");
  backBtn.className = "text-[#ffffff] hover:underline mt-4 block";
  backBtn.textContent = "← Back to Shop";
  backBtn.onclick = () => {
    showSection("shopSection");
    window.history.pushState({}, "", "/shop");
  };

  content.appendChild(title);
  content.appendChild(price);
  content.appendChild(shortDesc);
  content.appendChild(longDesc);
  content.appendChild(featureList);
  content.appendChild(priceWrap);
  content.appendChild(backBtn);

  wrapper.appendChild(img);
  wrapper.appendChild(content);
  detail.appendChild(wrapper);

  renderProductReviews(product.id);
  setupReviewForm(product.id);
  renderRelatedSuggestions(product);

  window.history.pushState({}, "", `/shop/${product.slug}`);

  setPageMeta({
    title: `${product.name || product.title} | Recovery Tools`,
    description: product.shortDescription || product.longDescription?.slice(0, 140),
    url: `https://recoverytools.au/shop/${product.slug}`,
  });

  injectProductSchema(product);

  showSection("productDetailSection");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function injectProductSchema(product) {
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.innerHTML = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    "name": product.name || product.title,
    "image": product.images?.[0] || product.image,
    "description": product.shortDescription || product.longDescription,
    "sku": product.slug,
    "brand": { "@type": "Organization", "name": "Recovery Tools" },
    "offers": {
      "@type": "Offer",
      "priceCurrency": "AUD",
      "price": (product.salePrice || product.price) / 100,
      "availability": product.stock > 0 ? "InStock" : "OutOfStock",
      "url": `https://recoverytools.au/shop/${product.slug}`,
    },
  });
  document.head.appendChild(script);
} 