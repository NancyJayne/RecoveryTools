// 🛒 shop-cart.js – Modular Cart Logic for Recovery Tools

import { showToast } from "../utils/utils.js";
import { auth, db, functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";

async function loadSharedCart() {
  const sharedCartId = new URLSearchParams(window.location.search).get("sharedCart");
  if (!sharedCartId) return;
  try {
    const snapshot = await getDoc(doc(db, "sharedCarts", sharedCartId));
    const data = snapshot.exists() ? snapshot.data() : null;
    if (!data?.active || !Array.isArray(data.items) || !data.items.length) {
      return showToast("This shared cart is no longer available.", "error");
    }
    setCart(data.items);
    showToast("Shared cart loaded. Review it before checkout.", "success");
  } catch (err) {
    console.error("Unable to load shared cart:", err);
    showToast("Unable to load the shared cart.", "error");
  }
}

export async function initCartUI() {
  const openBtns = document.querySelectorAll(".open-cart-btn");
  const closeBtn = document.getElementById("closeCartBtn");
  const checkoutBtn = document.getElementById("cartCheckoutBtn");
  const overlay = document.getElementById("cartOverlay");

  openBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openCartDrawer();
    });
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", closeCartDrawer);
  }

  if (overlay) {
    overlay.addEventListener("click", closeCartDrawer);
  }

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      console.log("🛒 Checkout button clicked");
      window.location.assign("/checkout");
    });
  } else {
    console.warn("⚠ cartCheckoutBtn not found when initCartUI ran");
  }

  await loadSharedCart();
  renderCartItems();
  updateCartCount();
}

export function openCartDrawer() {
  document.getElementById("cartDrawer")?.classList.remove("translate-x-full");
  document.getElementById("cartOverlay")?.classList.remove("hidden");
}

export function closeCartDrawer() {
  document.getElementById("cartDrawer")?.classList.add("translate-x-full");
  document.getElementById("cartOverlay")?.classList.add("hidden");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeCartDrawer();
  }
});

export function addToCart(item) {
  const cart = JSON.parse(localStorage.getItem("recovery_cart") || "[]");
  const existingItem = cart.find((i) =>
    i.id === item.id &&
    i.type === item.type &&
    (i.variantId || "") === (item.variantId || "") &&
    (i.physicalFulfilment || (i.requiresShipping ? "shipping" : "none")) ===
      (item.physicalFulfilment || (item.requiresShipping ? "shipping" : "none")),
  );

  if (existingItem) {
    existingItem.quantity += item.quantity || 1;
  } else {
    cart.push({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity || 1,
      type: item.type || "tool",
      requiresShipping: item.requiresShipping === true,
      physicalFulfilment: item.physicalFulfilment || (item.requiresShipping ? "shipping" : "none"),
      variantId: item.variantId || "",
      variantName: item.variantName || "",
      sku: item.sku || "",
      creatorId: item.creatorId || "admin",
      affiliatePercent:
        item.affiliatePercent ??
        (item.type === "tool" ? 0.1 : item.type === "course" ? 0.8 : 0.5),
      image: item.image || "/images/product-placeholder.png",
    });
  }

  localStorage.setItem("recovery_cart", JSON.stringify(cart));
  renderCartItems();
  openCartDrawer();
  updateCartCount();
  showToast("Item added to cart", "success");
}

export async function renderCartItems() {
  const itemCountEl = document.getElementById("cartItemCount");
  const container = document.getElementById("cartItemsContainer");
  const subtotalEl = document.getElementById("cartSubtotal");
  const shippingEl = document.getElementById("estimatedShippingCost");
  const estimatedTotalEl = document.getElementById("cartEstimatedTotal");
  const affiliateSelect = document.getElementById("affiliateSelector");
  if (!container || !subtotalEl) return;

  let cart = JSON.parse(localStorage.getItem("recovery_cart") || "[]");
  const hasShippingItems = cart.some((item) => item.requiresShipping === true);
  const typePriority = { tool: 1, course: 2, workshop: 3 };
  cart.sort((a, b) => (typePriority[a.type] || 99) - (typePriority[b.type] || 99));

  const grouped = cart.reduce((acc, item) => {
    acc[item.type] = acc[item.type] || [];
    acc[item.type].push(item);
    return acc;
  }, {});

  container.textContent = "";
  let itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  if (itemCountEl) itemCountEl.textContent = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  let subtotal = 0;

  Object.keys(grouped).forEach((type) => {
    const section = document.createElement("div");
    section.className = "mb-4";

    const heading = document.createElement("h3");
    heading.className = "text-sm uppercase text-gray-400 mb-2 mt-2";
    heading.textContent = type.charAt(0).toUpperCase() + type.slice(1);
    section.appendChild(heading);

    grouped[type].forEach((item) => {
      const itemPrice = Number(item.price ?? item.priceFrom ?? 0);
      const itemTotal = itemPrice * item.quantity;
      subtotal += itemTotal;

      const itemRow = document.createElement("div");
      itemRow.className = "flex items-center justify-between gap-4 border-b border-gray-700 py-2";

      const left = document.createElement("div");
      left.className = "flex gap-3 items-center";

      const img = document.createElement("img");
      img.src = item.image || "/images/product-placeholder.png";
      img.alt = item.name;
      img.className = "w-12 h-12 object-cover rounded";

      const info = document.createElement("div");
      const name = document.createElement("div");
      name.className = "font-semibold";
      name.textContent = item.name;

      const details = document.createElement("div");
      details.className = "text-sm text-gray-400";
      details.textContent = `$${itemPrice.toFixed(2)} × ${item.quantity}`;

      const variant = document.createElement("div");
      variant.className = "text-xs text-gray-300";
      variant.textContent = item.variantName ? `Variant: ${item.variantName}` : "";

      const fulfilment = document.createElement("div");
      fulfilment.className = "text-xs text-gray-300";
      fulfilment.textContent = item.physicalFulfilment === "pickup"
        ? "Fulfilment: Pickup"
        : item.physicalFulfilment === "shipping"
          ? "Fulfilment: Shipping"
          : "";

      info.appendChild(name);
      if (item.variantName) info.appendChild(variant);
      if (fulfilment.textContent) info.appendChild(fulfilment);
      info.appendChild(details);
      left.appendChild(img);
      left.appendChild(info);

      const right = document.createElement("div");
      right.className = "flex gap-2 items-center";

      [
        { action: "decrease", label: "−", class: "bg-gray-700 px-2 rounded text-white" },
        { action: "increase", label: "+", class: "bg-gray-700 px-2 rounded text-white" },
        { action: "remove", label: "×", class: "text-red-400 hover:text-red-600" },
      ].forEach(({ action, label, class: className }) => {
        const btn = document.createElement("button");
        btn.setAttribute("aria-label", `${action} quantity`);
        btn.className = className;
        btn.dataset.action = action;
        btn.dataset.index = cart.indexOf(item);
        btn.textContent = label;
        right.appendChild(btn);
      });

      itemRow.appendChild(left);
      itemRow.appendChild(right);
      section.appendChild(itemRow);
    });

    container.appendChild(section);
  });

  subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
  const showEstimatedTotal = (shippingCost) => {
    if (estimatedTotalEl) estimatedTotalEl.textContent = `$${(subtotal + shippingCost).toFixed(2)}`;
  };

  try {
    if (!hasShippingItems) {
      if (shippingEl) shippingEl.textContent = "$0.00";
      showEstimatedTotal(0);
    } else {
      const fetchSettings = httpsCallable(functions, "getShippingTaxSettings");
      const settingsRes = await fetchSettings();
      const { freeShippingMin = 0 } = settingsRes.data || {};
      const rawZones = settingsRes.data?.shippingZones;
      const shippingZones = Array.isArray(rawZones)
        ? rawZones
        : rawZones && typeof rawZones === "object"
          ? Object.values(rawZones)
          : [];
      const shippingRate = shippingZones.find((z) => z?.default)?.rate ?? shippingZones[0]?.rate ?? 10;
      const hasFreeShippingThreshold = Number(freeShippingMin) > 0;
      const shippingCost = hasFreeShippingThreshold && subtotal >= Number(freeShippingMin)
        ? 0
        : Number(shippingRate);

      if (shippingEl) shippingEl.textContent = `$${shippingCost.toFixed(2)}`;
      showEstimatedTotal(shippingCost);
    }
  } catch (err) {
    console.error("Shipping estimate error:", err);
    if (shippingEl) shippingEl.textContent = "$0.00";
    showEstimatedTotal(0);
  }

  const hasTools = cart.some((item) => item.type === "tool");
  const hasPickupItems = cart.some((item) => item.physicalFulfilment === "pickup");
  const canChooseAffiliate = (hasTools || hasPickupItems) && Boolean(auth?.currentUser);
  const affiliateBlock = affiliateSelect?.closest(".p-4.border-t");
  if (affiliateBlock) affiliateBlock.style.display = canChooseAffiliate ? "block" : "none";

  if (canChooseAffiliate && affiliateSelect && !affiliateSelect.dataset.loaded) {
    const getCheckoutAffiliates = httpsCallable(functions, "getCheckoutAffiliates");
    getCheckoutAffiliates()
      .then((response) => {
          affiliateSelect.innerHTML = "<option value=\"\">No Affiliate / I found this myself</option>";
          (response.data?.affiliates || []).forEach((affiliate) => {
            const option = document.createElement("option");
            option.value = affiliate.affiliateId;
            option.textContent = affiliate.businessName || affiliate.affiliateId;
            affiliateSelect.appendChild(option);
          });

          const storedAffiliate = localStorage.getItem("referrer_uid");
          if (storedAffiliate) affiliateSelect.value = storedAffiliate;

          affiliateSelect.dataset.loaded = true;
      })
      .catch((err) => {
        console.error("Failed to load affiliates:", err);
        showToast("Unable to load referrer list", "error");
      });

    affiliateSelect.addEventListener("change", () => {
      localStorage.setItem("referrer_uid", affiliateSelect.value);
    });
  }

  container.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      const index = parseInt(button.getAttribute("data-index"));
      if (isNaN(index)) return;
      updateCartItem(index, action);
    });
  });
  updateCartCount();
}

function updateCartItem(index, action) {
  const cart = JSON.parse(localStorage.getItem("recovery_cart") || "[]");
  if (!cart[index]) return;

  if (action === "increase") cart[index].quantity += 1;
  if (action === "decrease") cart[index].quantity = Math.max(1, cart[index].quantity - 1);
  if (action === "remove") cart.splice(index, 1);

  localStorage.setItem("recovery_cart", JSON.stringify(cart));
  renderCartItems();
  updateCartCount();
}

export function refreshCart() {
  renderCartItems();
  updateCartCount();
}

export function updateCartCount() {
  const cart = getCurrentCart();
  const count = cart.reduce((sum, i) => sum + i.quantity, 0);
  const cartCountEl = document.getElementById("cartCount");
  if (cartCountEl) cartCountEl.textContent = count;
}

export function getCurrentCart() {
  return JSON.parse(localStorage.getItem("recovery_cart") || "[]");
}

export function setCart(cart) {
  localStorage.setItem("recovery_cart", JSON.stringify(cart));
}

window.openCartDrawer = openCartDrawer;

export default initCartUI;
