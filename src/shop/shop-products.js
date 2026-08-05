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

function getVariantImage(product, variant) {
  return variant?.images?.[0] ||
    variant?.media?.find((asset) => asset?.type === "image")?.url ||
    getProductImage(product);
}

function getVariantImageAlt(product, variant) {
  return variant?.media?.find((asset) => asset?.url === getVariantImage(product, variant))?.altText ||
    `${getProductName(product)}${variant ? ` - ${getVariantLabel(variant)}` : ""}`;
}

function getProductShortDescription(product) {
  return product.shortDescription || product.description || product.longDescription || "";
}

function getProductLongDescription(product) {
  return product.longDescription || product.description || product.shortDescription || "";
}

function getVariantLongDescription(product, variant) {
  return variant?.longDescription || variant?.shortDescription || getProductLongDescription(product);
}

function courseVideoMedia(product) {
  return product.coursePreviewVideo?.url ? product.coursePreviewVideo : null;
}

function youtubeEmbedUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname.includes("youtube-nocookie.com") && url.pathname.startsWith("/embed/")) {
      return url.toString();
    }
    const videoId = url.hostname === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.searchParams.get("v") ||
        (url.pathname.startsWith("/embed/") ? url.pathname.split("/")[2] : "");
    return videoId ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}` : "";
  } catch {
    return "";
  }
}

function audibleVideoEmbedUrl(embedUrl, sourceUrl) {
  const value = embedUrl || youtubeEmbedUrl(sourceUrl);
  if (!value) return "";
  try {
    const url = new URL(value);
    url.searchParams.delete("mute");
    url.searchParams.delete("autoplay");
    url.searchParams.set("controls", "1");
    url.searchParams.set("playsinline", "1");
    return url.toString();
  } catch {
    return value;
  }
}

function protectDisplayedMedia(element) {
  if (!element) return element;
  element.draggable = false;
  element.classList.add("select-none");
  element.style.webkitUserDrag = "none";
  element.addEventListener("contextmenu", (event) => event.preventDefault());
  element.addEventListener("dragstart", (event) => event.preventDefault());
  return element;
}

function courseDetailMarkup(product) {
  if (productCategory(product) !== "courses") return null;
  const section = document.createElement("section");
  section.className = "mb-5 space-y-5 rounded border border-gray-700 bg-gray-900/50 p-4";
  const video = courseVideoMedia(product);
  if (video?.url) {
    const videoHeading = document.createElement("h3");
    videoHeading.className = "text-lg font-semibold text-white";
    videoHeading.textContent = "Course preview";
    const embedUrl = audibleVideoEmbedUrl(video.embedUrl, video.url);
    const player = embedUrl
      ? document.createElement("iframe")
      : document.createElement("video");
    player.className = "aspect-video w-full rounded bg-black";
    if (embedUrl) {
      player.src = embedUrl;
      player.title = video.title || "Course preview video";
      player.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      player.allowFullscreen = true;
      player.loading = "lazy";
    } else {
      player.src = video.url;
      player.controls = true;
      player.preload = "metadata";
      player.playsInline = true;
      player.defaultMuted = false;
      player.muted = false;
      player.volume = 1;
      player.controlsList = "nodownload noremoteplayback";
      player.disablePictureInPicture = true;
      player.disableRemotePlayback = true;
    }
    protectDisplayedMedia(player);
    section.append(videoHeading, player);
  }
  const modules = Array.isArray(product.courseModules) ? product.courseModules : [];
  if (modules.length) {
    const moduleHeading = document.createElement("h3");
    moduleHeading.className = "text-lg font-semibold text-white";
    moduleHeading.textContent = `Course modules (${modules.length})`;
    const list = document.createElement("ol");
    list.className = "space-y-2";
    modules.forEach((module, index) => {
      const item = document.createElement("li");
      item.className = "rounded border border-gray-700 bg-gray-950/50 p-3";
      const title = document.createElement("div");
      title.className = "font-medium text-white";
      title.textContent = `${index + 1}. ${module.name || module.id}`;
      item.appendChild(title);
      if (module.shortDescription) {
        const description = document.createElement("p");
        description.className = "mt-1 text-sm text-gray-400";
        description.textContent = module.shortDescription;
        item.appendChild(description);
      }
      list.appendChild(item);
    });
    section.append(moduleHeading, list);
  }
  return section.children.length ? section : null;
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
  const override = Number(variant?.priceOverride);
  return Number.isFinite(override) && override > 0
    ? override
    : getProductPrice(product);
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

function productExperienceDetails(product, variant = null) {
  return [
    ["Starts", formatProductDateTime(variant?.eventStartAt || product.eventStartAt)],
    ["Ends", formatProductDateTime(variant?.eventEndAt || product.eventEndAt)],
    ["Address", variant?.eventLocation || product.eventLocation],
    ["Booking", variant?.calendarBookingReference || product.calendarBookingReference],
    ["Instructor", variant?.instructor || product.instructor],
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
    product.productType,
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
  wrapper.dataset.productDescription = getProductShortDescription(product);
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

  if (product.comingSoon === true) {
    const badge = document.createElement("span");
    badge.textContent = "Coming soon";
    badge.className = `absolute left-2 ${isFeatured(product) ? "top-10" : "top-2"} rounded bg-purple-700
      px-2 py-1 text-xs font-semibold text-white`;
    wrapper.appendChild(badge);
  }
  if (product.pricingTier === "affiliate-wholesale") {
    const badge = document.createElement("span");
    badge.textContent = "Affiliate wholesale";
    badge.className = "absolute bottom-2 left-2 rounded bg-[#407471] px-2 py-1 text-xs font-semibold text-white";
    wrapper.appendChild(badge);
  }

  const image = document.createElement("img");
  image.src = productImage;
  image.alt = getProductImageAlt(product);
  image.className = "w-full h-48 object-cover rounded";
  protectDisplayedMedia(image);

  const name = document.createElement("h3");
  name.textContent = productName;
  name.className = "text-lg font-semibold mt-2 text-white";

  const shortDesc = document.createElement("p");
  shortDesc.textContent = getProductShortDescription(product);
  shortDesc.className = "text-sm text-gray-300 mt-1";

  const price = document.createElement("p");
  price.innerHTML =
  product.onSale && product.salePrice
    ? `<span class="line-through text-gray-500 mr-2">
         ${asMoney(product.retailPrice)}
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
  if (detail.dataset.mediaProtectionBound !== "true") {
    detail.dataset.mediaProtectionBound = "true";
    detail.addEventListener("contextmenu", (event) => {
      if (event.target.closest("img, video")) event.preventDefault();
    });
    detail.addEventListener("dragstart", (event) => {
      if (event.target.closest("img, video")) event.preventDefault();
    });
  }
  const productName = getProductName(product);
  const productImage = getProductImage(product);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  let selectedVariant = variants.find((variant) =>
    variant.purchasable !== false && Number(variant.stock ?? 0) > 0,
  ) || variants.find((variant) => variant.purchasable !== false) || variants[0] || null;
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
  protectDisplayedMedia(img);

  const content = document.createElement("div");
  content.className = "flex flex-col md:w-1/2 px-4";

  const title = document.createElement("h2");
  title.textContent = productName;
  title.className = "text-2xl font-bold mb-2";

  const price = document.createElement("span");
  function updatePriceDisplay() {
    finalPrice = getVariantPrice(product, selectedVariant);
    price.innerHTML =
      selectedVariant?.onSale
        ? `<span class="line-through text-gray-500 mr-2">
             ${asMoney(selectedVariant.retailPriceOverride)}
           </span><span class="text-green-400 font-bold">
             ${asMoney(finalPrice)}
           </span>`
        : product.onSale && product.salePrice && !selectedVariant?.priceOverride
          ? `<span class="line-through text-gray-500 mr-2">
             ${asMoney(product.retailPrice)}
           </span><span class="text-green-400 font-bold">
             ${asMoney(finalPrice)}
           </span>`
          : asMoney(finalPrice);
  }
  function updateProductImage() {
    img.src = getVariantImage(product, selectedVariant);
    img.alt = getVariantImageAlt(product, selectedVariant);
  }
  updateProductImage();
  updatePriceDisplay();
  price.className = "text-green-400 text-xl font-bold mb-2";


  const longDesc = document.createElement("p");
  function updateDescription() {
    const description = getVariantLongDescription(product, selectedVariant);
    const inclusions = selectedVariant?.inclusions || "";
    longDesc.textContent = [description, inclusions].filter(Boolean).join("\n\n");
  }
  updateDescription();
  longDesc.className = "whitespace-pre-line text-sm text-gray-300 mb-4";

  const featureList = document.createElement("ul");
  featureList.className = "list-disc ml-5 text-sm text-gray-300 mb-4";
  (product.features || []).forEach((f) => {
    const li = document.createElement("li");
    li.textContent = f;
    featureList.appendChild(li);
  });
  let courseDetails = courseDetailMarkup(product);
  function updateCourseDetails() {
    if (productCategory(product) !== "courses") return;
    const replacement = courseDetailMarkup(product);
    if (courseDetails?.isConnected) {
      if (replacement) courseDetails.replaceWith(replacement);
      else courseDetails.remove();
    } else if (replacement) {
      const anchor = experienceDetails.isConnected ? experienceDetails : priceWrap;
      content.insertBefore(replacement, anchor);
    }
    courseDetails = replacement;
  }

  const experienceDetails = document.createElement("dl");
  experienceDetails.className = "mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm";
  function updateExperienceDetails() {
    experienceDetails.innerHTML = "";
    productExperienceDetails(product, selectedVariant).forEach(([label, value]) => {
      const term = document.createElement("dt");
      term.className = "font-semibold text-gray-300";
      term.textContent = label;
      const description = document.createElement("dd");
      description.className = "text-gray-400";
      description.textContent = String(value);
      experienceDetails.append(term, description);
    });
  }
  updateExperienceDetails();

  const capacityWarning = document.createElement("p");
  capacityWarning.className = "mb-4 hidden rounded border border-amber-600/60 bg-amber-950/40 px-3 py-2 text-sm font-semibold text-amber-200";
  function updateCapacityWarning() {
    const remaining = Number(selectedVariant?.ticketsRemaining);
    const threshold = Number(selectedVariant?.nearCapacityWarning);
    const shouldWarn = productCategory(product) === "workshops" &&
      selectedVariant?.ticketsRemaining !== null &&
      Number.isFinite(remaining) && Number.isFinite(threshold) &&
      threshold > 0 && remaining <= threshold;
    capacityWarning.classList.toggle("hidden", !shouldWarn);
    capacityWarning.textContent = remaining > 0
      ? `Almost sold out — only ${remaining} place${remaining === 1 ? "" : "s"} left.`
      : "Sold out.";
  }
  updateCapacityWarning();

  const priceWrap = document.createElement("div");
  priceWrap.className = "flex flex-col gap-4 mb-4";
  function configuredPhysicalFulfilment() {
    return selectedVariant?.physicalFulfilment || product.physicalFulfilment ||
      (product.requiresShipping ? "shipping" : "none");
  }

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
      option.textContent = `${getVariantLabel(variant)} - ${asMoney(getVariantPrice(product, variant))}` +
        (variant.comingSoon ? " - Coming soon" : "");
      option.disabled = variant.purchasable === false;
      variantSelect.appendChild(option);
    });
    variantSelect.addEventListener("change", () => {
      selectedVariant = variants.find((variant) =>
        (variant.variantId || variant.id) === variantSelect.value,
      ) || null;
      updatePriceDisplay();
      updateProductImage();
      updateDescription();
      updateCourseDetails();
      updateExperienceDetails();
      updateCapacityWarning();
      quantity = Math.max(quantity, minimumQuantity());
      qtyDisplay.textContent = String(quantity);
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
  function minimumQuantity() {
    return selectedVariant?.pricingTier === "affiliate-wholesale" ||
      product.pricingTier === "affiliate-wholesale"
      ? Math.max(Number(selectedVariant?.wholesaleMinQuantity || product.wholesaleMinQuantity || 1), 1)
      : 1;
  }
  qtyDisplay.textContent = String(minimumQuantity());
  qtyDisplay.className = "text-white font-semibold w-8 text-center select-none";

  const plusBtn = document.createElement("button");
  plusBtn.textContent = "+";
  plusBtn.className = "bg-gray-700 text-white w-8 h-8 rounded text-lg";

  let quantity = minimumQuantity();
  minusBtn.onclick = () => {
    if (quantity > minimumQuantity()) {
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
    const isComingSoon = selectedVariant
      ? selectedVariant.purchasable === false || selectedVariant.comingSoon === true
      : product.purchasable === false || product.comingSoon === true;
    btn.textContent = isComingSoon ? "Coming soon" : isOutOfStock ? "Out of Stock" : "Add to Cart";
    btn.disabled = isOutOfStock || isComingSoon;
    btn.classList.toggle("opacity-50", btn.disabled);
    btn.classList.toggle("cursor-not-allowed", btn.disabled);
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
      configuredPhysicalFulfilment: configuredPhysicalFulfilment(),
      physicalFulfilment: configuredPhysicalFulfilment() === "shipping-or-pickup"
        ? ""
        : configuredPhysicalFulfilment(),
      requiresShipping: configuredPhysicalFulfilment() === "shipping",
      variantId: selectedVariant?.variantId || selectedVariant?.id || "",
      variantName: selectedVariant ? getVariantLabel(selectedVariant) : "",
      sku: selectedVariant?.sku || product.sku || "",
      creatorId: product.creatorId,
      affiliatePercent: product.affiliatePercent,
      pricingTier: selectedVariant?.pricingTier || product.pricingTier || "retail",
      wholesaleMinQuantity: selectedVariant?.wholesaleMinQuantity || product.wholesaleMinQuantity || 1,
      image: getVariantImage(product, selectedVariant),
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
  content.appendChild(longDesc);
  content.appendChild(featureList);
  if (courseDetails) content.appendChild(courseDetails);
  if (experienceDetails.children.length) content.appendChild(experienceDetails);
  content.appendChild(capacityWarning);
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
    description: getProductShortDescription(product).slice(0, 160),
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
    "description": getProductShortDescription(product) || getProductLongDescription(product),
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
