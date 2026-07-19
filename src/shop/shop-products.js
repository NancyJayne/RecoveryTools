// Load/display product catalog
// src/shop/shop-products.js

import { functions } from "../utils/firebase-config.js";
import { logClientError } from "../utils/logClientError.js";
import { httpsCallable } from "firebase/functions";
import { renderProductReviews, setupReviewForm } from "./shop-reviews.js";
import { renderRelatedSuggestions } from "./shop-related.js";
import { addToCart } from "./shop-cart.js";
import { setPageMeta } from "../utils/seo-utils.js";
import { showToast, showTabContent } from "../utils/utils.js";

const PRODUCT_PLACEHOLDER = "/images/product-placeholder.png";
let allMarketplaceProducts = [];
let activeMarketplaceFilter = "all";

function asMoney(value) {
  const amount = Number(value ?? 0);
  return `$${amount.toFixed(2)}`;
}

function getProductName(product) {
  return product.name || product.title || product.productTitle || "Product";
}

function getProductImage(product) {
  return product.images?.[0] ||
    product.media?.find((asset) => asset?.type === "image")?.url ||
    product.image ||
    product.imageUrl ||
    PRODUCT_PLACEHOLDER;
}

function getProductImageAlt(product) {
  return product.media?.find((asset) => asset?.url === getProductImage(product))?.altText ||
    getProductName(product);
}

function getProductPrice(product) {
  return Number(product.onSale && product.salePrice ? product.salePrice : product.price ?? product.priceFrom ?? 0);
}

function getVariantLabel(variant) {
  return variant.name ||
    [variant.colour, variant.size].filter(Boolean).join(" / ") ||
    variant.sku ||
    "Variant";
}

function getVariantPrice(product, variant) {
  return Number(variant?.priceOverride ?? getProductPrice(product));
}

function getProductTags(product) {
  return [
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.tagIds) ? product.tagIds : []),
  ];
}

function formatProductDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Australia/Brisbane",
    }).format(date);
}

function productExperienceDetails(product) {
  return [
    ["Starts", formatProductDateTime(product.eventStartAt)],
    ["Ends", formatProductDateTime(product.eventEndAt)],
    ["Location", product.eventLocation],
    ["Delivery", product.deliveryMode],
    ["Instructor", product.instructor],
    ["Tickets / seats", product.tracksSeats ? product.seatCapacity : ""],
    ["Access", product.unlocksAccess ? product.accessType || "Included after purchase" : ""],
    ["Certificate", product.issuesCertificate ? product.certificateName || "Included" : ""],
  ].filter(([, value]) => value !== "" && value !== null && value !== undefined);
}

function isFeatured(product) {
  return product.featured === true || getProductTags(product).includes("featured");
}

function productCategory(product) {
  const values = [
    product.categoryId,
    product.type,
    product.itemType,
    product.itemKind,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  if (values.includes("course")) return "courses";
  if (values.includes("workshop") || values.includes("webinar") || values.includes("session")) return "workshops";
  if (values.includes("program") || values.includes("plan")) return "programs";
  return "tools";
}

function categoryLabel(category) {
  return {
    tools: "Tools",
    courses: "Courses",
    workshops: "Workshops",
    programs: "Programs",
  }[category] || "Marketplace";
}

export function productTypeLabel(product) {
  return categoryLabel(productCategory(product)).replace(/s$/, "");
}

function sortProducts(products) {
  const sortValue = document.getElementById("sortSelect")?.value || "name";
  return [...products].sort((a, b) => {
    if (sortValue === "priceLow") return getProductPrice(a) - getProductPrice(b);
    if (sortValue === "priceHigh") return getProductPrice(b) - getProductPrice(a);
    return getProductName(a).localeCompare(getProductName(b));
  });
}

function setActiveFilterButton() {
  document.querySelectorAll(".filter-tag").forEach((button) => {
    const isActive = button.dataset.filter === activeMarketplaceFilter;
    button.classList.toggle("bg-[#407471]", isActive);
    button.classList.toggle("bg-gray-700", !isActive);
  });
}

function renderMarketplaceProducts(products) {
  const shopGrid = document.getElementById("shopGrid");
  if (!shopGrid) return;

  shopGrid.innerHTML = "";
  const categories = activeMarketplaceFilter === "all"
    ? ["tools", "courses", "workshops", "programs"]
    : [activeMarketplaceFilter];

  let renderedCount = 0;
  categories.forEach((category) => {
    const categoryProducts = sortProducts(products.filter((product) => productCategory(product) === category));
    if (!categoryProducts.length) return;

    const section = document.createElement("section");
    section.className = "col-span-full";

    const heading = document.createElement("h3");
    heading.className = "mb-4 mt-2 text-xl font-semibold text-white";
    heading.textContent = categoryLabel(category);
    section.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4";
    categoryProducts.forEach((product) => {
      const tile = createProductTile(product);
      if (tile) {
        grid.appendChild(tile);
        renderedCount++;
      }
    });
    section.appendChild(grid);
    shopGrid.appendChild(section);
  });

  if (!renderedCount) {
    shopGrid.innerHTML = `<p class="text-gray-400">No marketplace items found.</p>`;
  }
}

function setupMarketplaceControls() {
  document.querySelectorAll(".filter-tag").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      activeMarketplaceFilter = button.dataset.filter || "all";
      setActiveFilterButton();
      renderMarketplaceProducts(allMarketplaceProducts);
    });
  });

  const sortSelect = document.getElementById("sortSelect");
  if (sortSelect && sortSelect.dataset.bound !== "true") {
    sortSelect.dataset.bound = "true";
    sortSelect.addEventListener("change", () => renderMarketplaceProducts(allMarketplaceProducts));
  }
  setActiveFilterButton();
}

function routeProductKey() {
  const [, section, productKey] = window.location.pathname.split("/");
  if (section !== "shop" || !productKey) return "";
  return decodeURIComponent(productKey);
}

function productMatchesRoute(product, key) {
  return key && [product.id, product.slug, product.productId].filter(Boolean).includes(key);
}

function maybeOpenProductFromRoute(products) {
  const key = routeProductKey();
  if (!key) return false;

  const product = products.find((candidate) => productMatchesRoute(candidate, key));
  if (!product) return false;

  showProductDetail(product, { preserveUrl: true });

  if (new URLSearchParams(window.location.search).get("review") === "1") {
    setTimeout(() => {
      document.getElementById("reviewForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("reviewRating")?.focus();
    }, 250);
  }

  return true;
}

export async function loadProducts() {
  const shopGrid = document.getElementById("shopGrid");
  if (!shopGrid) return;

  shopGrid.innerHTML = `
    <div class="flex justify-center items-center min-h-[200px]">
      <div class="w-12 h-12 border-4 border-t-4 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  `;

  try {
    const getProducts = httpsCallable(functions, "getFirestoreProducts");
    const res = await getProducts({});
    const products = Array.isArray(res.data?.products) ? res.data.products : [];
    allMarketplaceProducts = products;


    shopGrid.innerHTML = "";

    if (products.length === 0) {
      shopGrid.innerHTML = `<p class="text-gray-400">No marketplace items available.</p>`;
      return;
    }

    setupMarketplaceControls();
    renderMarketplaceProducts(products);

    maybeOpenProductFromRoute(products);

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
  const productName = getProductName(product);
  const productImage = getProductImage(product);
  const finalPrice = getProductPrice(product);

  const wrapper = document.createElement("div");
  wrapper.className = "relative bg-gray-800 p-4 rounded-lg shadow hover:ring-2 hover:ring-[#407471]";
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute("tabindex", "0");
  wrapper.setAttribute(
    "aria-label",
    `View details for ${productName}`,
  );
  wrapper.setAttribute("aria-pressed", "false");
  wrapper.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      wrapper.click();
    }
  });

  wrapper.dataset.productId = product.id;
  wrapper.dataset.productName = productName;
  wrapper.dataset.productPrice = finalPrice;
  wrapper.dataset.productImage = productImage;
  wrapper.dataset.productDescription = product.shortDescription || "";
  wrapper.dataset.productStock = product.stock ?? 0;
  wrapper.dataset.productFull = JSON.stringify(product);

  const typeBadge = document.createElement("span");
  typeBadge.textContent = productTypeLabel(product);
  typeBadge.className = "absolute right-2 top-2 rounded bg-[#407471] px-2 py-1 text-xs font-semibold text-white";
  wrapper.appendChild(typeBadge);

  if (isFeatured(product)) {
    const badge = document.createElement("span");
    badge.textContent = "★ Featured";
    badge.className = "absolute top-2 left-2 bg-yellow-500 text-black text-xs px-2 py-1 rounded";
    wrapper.appendChild(badge);
  }

  const image = document.createElement("img");
  image.src = productImage;
  image.alt = getProductImageAlt(product);
  image.className = "w-full h-48 object-cover rounded";

  const name = document.createElement("h3");
  name.textContent = productName;
  name.className = "text-lg font-semibold mt-2 text-white";

  const shortDesc = document.createElement("p");
  shortDesc.textContent = product.shortDescription || "";
  shortDesc.className = "text-sm text-gray-300 mt-1";

  const price = document.createElement("p");
  price.innerHTML =
  product.onSale && product.salePrice
    ? `<span class="line-through text-gray-500 mr-2">
         ${asMoney(product.price)}
       </span><span class="text-green-400 font-bold">
         ${asMoney(finalPrice)}
       </span>`
    : asMoney(finalPrice);

  price.className = "mt-1";

  wrapper.appendChild(image);
  wrapper.appendChild(name);
  wrapper.appendChild(shortDesc);
  wrapper.appendChild(price);

  const tracksInventory = product.inventoryTracked !== false;
  const variantStock = Array.isArray(product.variants)
    ? product.variants.reduce((sum, variant) => sum + Number(variant.stock ?? 0), 0)
    : 0;
  const availableStock = product.variants?.length ? variantStock : Number(product.stock ?? 0);
  if (tracksInventory && availableStock === 0) {
    const overlay = document.createElement("div");
    overlay.className = "absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center rounded";
    overlay.innerHTML = `<span class="text-white font-semibold text-lg">Out of Stock</span>`;
    wrapper.appendChild(overlay);
  }

  return wrapper;
}

export function showProductDetail(product, options = {}) {
  const detail = document.getElementById("productDetailContainer");
  if (detail.dataset.currentId === product.id) return;
  const productName = getProductName(product);
  const productImage = getProductImage(product);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  let selectedVariant = variants.find((variant) => Number(variant.stock ?? 0) > 0) || variants[0] || null;
  let finalPrice = getVariantPrice(product, selectedVariant);

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
  img.src = productImage;
  img.alt = getProductImageAlt(product);
  img.className = "w-full h-auto max-h-[400px] object-cover rounded md:max-w-[600px]";

  const content = document.createElement("div");
  content.className = "flex flex-col md:w-1/2 px-4";

  const title = document.createElement("h2");
  title.textContent = productName;
  title.className = "text-2xl font-bold mb-2";

  const price = document.createElement("span");
  function updatePriceDisplay() {
    finalPrice = getVariantPrice(product, selectedVariant);
    price.innerHTML =
      product.onSale && product.salePrice && !selectedVariant?.priceOverride
        ? `<span class="line-through text-gray-500 mr-2">
             ${asMoney(product.price)}
           </span><span class="text-green-400 font-bold">
             ${asMoney(finalPrice)}
           </span>`
        : asMoney(finalPrice);
  }
  updatePriceDisplay();
  price.className = "text-green-400 text-xl font-bold mb-2";


  const shortDesc = document.createElement("p");
  shortDesc.textContent = product.shortDescription || "";
  shortDesc.className = "text-sm text-gray-300 mb-2";

  const longDesc = document.createElement("p");
  longDesc.textContent = product.longDescription || "";
  longDesc.className = "text-sm text-gray-400 mb-4";

  const featureList = document.createElement("ul");
  featureList.className = "list-disc ml-5 text-sm text-gray-300 mb-4";
  (product.features || []).forEach((f) => {
    const li = document.createElement("li");
    li.textContent = f;
    featureList.appendChild(li);
  });

  const experienceDetails = document.createElement("dl");
  experienceDetails.className = "mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm";
  productExperienceDetails(product).forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.className = "font-semibold text-gray-300";
    term.textContent = label;
    const description = document.createElement("dd");
    description.className = "text-gray-400";
    description.textContent = String(value);
    experienceDetails.append(term, description);
  });

  const priceWrap = document.createElement("div");
  priceWrap.className = "flex flex-col gap-4 mb-4";

  let variantSelect = null;
  if (variants.length) {
    const variantLabel = document.createElement("label");
    variantLabel.className = "text-sm text-gray-300";
    variantLabel.textContent = "Choose option";

    variantSelect = document.createElement("select");
    variantSelect.className = "mt-1 w-full rounded bg-gray-800 px-3 py-2 text-white";
    variants.forEach((variant) => {
      const option = document.createElement("option");
      option.value = variant.variantId || variant.id;
      option.textContent = `${getVariantLabel(variant)} - ${asMoney(getVariantPrice(product, variant))}`;
      variantSelect.appendChild(option);
    });
    variantSelect.addEventListener("change", () => {
      selectedVariant = variants.find((variant) =>
        (variant.variantId || variant.id) === variantSelect.value,
      ) || null;
      updatePriceDisplay();
      updateAddButtonState();
    });

    variantLabel.appendChild(variantSelect);
    if (selectedVariant) variantSelect.value = selectedVariant.variantId || selectedVariant.id;
    priceWrap.appendChild(variantLabel);
  }

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
  function currentStock() {
    return selectedVariant ? Number(selectedVariant.stock ?? 0) : Number(product.stock ?? 0);
  }

  function updateAddButtonState() {
    const tracksInventory = product.inventoryTracked !== false;
    const isOutOfStock = tracksInventory && currentStock() === 0;
    btn.textContent = isOutOfStock ? "Out of Stock" : "Add to Cart";
    btn.disabled = isOutOfStock;
    btn.classList.toggle("opacity-50", isOutOfStock);
    btn.classList.toggle("cursor-not-allowed", isOutOfStock);
  }
  updateAddButtonState();
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    addToCart({
      id: product.id,
      name: selectedVariant ? `${productName} - ${getVariantLabel(selectedVariant)}` : productName,
      price: finalPrice,
      quantity,
      type: product.type || "tool",
      requiresShipping: product.requiresShipping !== false,
      variantId: selectedVariant?.variantId || selectedVariant?.id || "",
      variantName: selectedVariant ? getVariantLabel(selectedVariant) : "",
      sku: selectedVariant?.sku || product.sku || "",
      creatorId: product.creatorId,
      affiliatePercent: product.affiliatePercent,
      image: productImage,
    });
  });

  priceWrap.appendChild(qtyWrap);
  priceWrap.appendChild(btn);

  const backBtn = document.createElement("button");
  backBtn.className = "text-[#ffffff] hover:underline mt-4 block";
  backBtn.textContent = "← Back to Shop";
  backBtn.onclick = () => {
    showTabContent("shopSection");
    window.history.pushState({}, "", "/shop");
  };

  content.appendChild(title);
  content.appendChild(price);
  content.appendChild(shortDesc);
  content.appendChild(longDesc);
  content.appendChild(featureList);
  if (experienceDetails.children.length) content.appendChild(experienceDetails);
  content.appendChild(priceWrap);
  content.appendChild(backBtn);

  wrapper.appendChild(img);
  wrapper.appendChild(content);


  const reviewsSection = document.createElement("div");
  reviewsSection.className = "max-w-screen-xl mx-auto px-4 sm:px-6 md:px-8 mt-8";
  reviewsSection.innerHTML = `
  <div id="reviews"></div>

  <form id="reviewForm" class="mt-6 space-y-3">
    <h4 class="text-lg font-semibold">Leave a Review</h4>

    <input
      id="reviewName"
      type="text"
      placeholder="Your name"
      class="w-full p-2 rounded bg-gray-800 text-white"
    />

    <select
      id="reviewRating"
      class="w-full p-2 rounded bg-gray-800 text-white"
    >
      <option value="">Select rating</option>
      <option value="5">★★★★★</option>
      <option value="4">★★★★☆</option>
      <option value="3">★★★☆☆</option>
      <option value="2">★★☆☆☆</option>
      <option value="1">★☆☆☆☆</option>
    </select>

    <textarea
      id="reviewComment"
      placeholder="Write your review"
      class="w-full p-2 rounded bg-gray-800 text-white"
    ></textarea>

    <button
      type="submit"
      class="bg-[#407471] text-white px-4 py-2 rounded"
    >
      Submit Review
    </button>
  </form>
`;

  detail.appendChild(wrapper);
  detail.appendChild(reviewsSection);

  renderProductReviews(product.id);
  setupReviewForm(product.id);
  renderRelatedSuggestions(product);

  const productSlug = product.slug || product.id;
  if (!options.preserveUrl) {
    window.history.pushState({}, "", `/shop/${productSlug}`);
  }

  setPageMeta({
    title: `${productName} | Recovery Tools`,
    description: product.shortDescription || product.longDescription?.slice(0, 140),
    url: `https://recoverytools.au/shop/${productSlug}`,
  });

  injectProductSchema(product);

  showTabContent("productDetailSection");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function injectProductSchema(product) {
  const productSlug = product.slug || product.id;
  const productName = getProductName(product);
  const productImage = getProductImage(product);
  const finalPrice = getProductPrice(product);
  const isOutOfStock = product.inventoryTracked !== false && product.stock === 0;

  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.innerHTML = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    "name": productName,
    "image": productImage,
    "description": product.shortDescription || product.longDescription,
    "sku": product.sku || productSlug,
    "brand": { "@type": "Organization", "name": "Recovery Tools" },
    "offers": {
      "@type": "Offer",
      "priceCurrency": "AUD",
      "price": finalPrice,
      "availability": isOutOfStock ? "OutOfStock" : "InStock",
      "url": `https://recoverytools.au/shop/${productSlug}`,
    },
  });
  document.head.appendChild(script);
} 
