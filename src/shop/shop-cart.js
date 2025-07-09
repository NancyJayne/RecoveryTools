// 🛒 shop-cart.js – Modular Cart Logic for Recovery Tools

import { showToast } from "../utils/utils.js";
import { functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";

export function initCartUI() {
  const openBtns = document.querySelectorAll(".open-cart-btn");
  const closeBtn = document.getElementById("closeCartBtn");
  const checkoutBtn = document.getElementById("checkoutBtn");
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
    checkoutBtn.addEventListener("click", () => {
      window.location.href = "/checkout";
    });
  }

  renderCartItems();
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
  const existingItem = cart.find((i) => i.id === item.id && i.type === item.type);

  if (existingItem) {
    existingItem.quantity += item.quantity || 1;
  } else {
    cart.push({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity || 1,
      type: item.type || "tool",
      creatorId: item.creatorId || "admin",
      affiliatePercent:
        item.affiliatePercent ??
        (item.type === "tool" ? 0.1 : item.type === "course" ? 0.8 : 0.5),
      image: item.image || "https://via.placeholder.com/60x60?text=Item",
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
  const affiliateSelect = document.getElementById("affiliateSelector");
  if (!container || !subtotalEl) return;

  let cart = JSON.parse(localStorage.getItem("recovery_cart") || "[]");
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
      const itemTotal = item.price * item.quantity;
      subtotal += itemTotal;

      const itemRow = document.createElement("div");
      itemRow.className = "flex items-center justify-between gap-4 border-b border-gray-700 py-2";

      const left = document.createElement("div");
      left.className = "flex gap-3 items-center";

      const img = document.createElement("img");
      img.src = item.image;
      img.alt = item.name;
      img.className = "w-12 h-12 object-cover rounded";

      const info = document.createElement("div");
      const name = document.createElement("div");
      name.className = "font-semibold";
      name.textContent = item.name;

      const details = document.createElement("div");
      details.className = "text-sm text-gray-400";
      details.textContent = `$${(item.price / 100).toFixed(2)} × ${item.quantity}`;

      info.appendChild(name);
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

  subtotalEl.textContent = `$${(subtotal / 100).toFixed(2)}`;

  try {
    const fetchSettings = httpsCallable(functions, "getShippingTaxSettings");
    const settingsRes = await fetchSettings();
    const { freeShippingMin = 0 } = settingsRes.data;
    let shippingCost = subtotal >= freeShippingMin * 100 ? 0 : 800;
    if (shippingEl) shippingEl.textContent = `$${(shippingCost / 100).toFixed(2)}`;
  } catch (err) {
    console.error("Shipping estimate error:", err);
    if (shippingEl) shippingEl.textContent = "$0.00";
  }

  const hasTools = cart.some((item) => item.type === "tool");
  const affiliateBlock = affiliateSelect?.closest(".p-4.border-t");
  if (affiliateBlock) affiliateBlock.style.display = hasTools ? "block" : "none";

  if (hasTools && affiliateSelect && !affiliateSelect.dataset.loaded) {
    import("firebase/firestore").then(({ getDocs, collection, getFirestore }) => {
      const db = getFirestore();
      getDocs(collection(db, "affiliates"))
        .then((snapshot) => {
          affiliateSelect.innerHTML = "<option value=\"\">No Affiliate / I found this myself</option>";
          snapshot.forEach((doc) => {
            const data = doc.data();
            const option = document.createElement("option");
            option.value = doc.id;
            option.textContent = data.businessName || doc.id;
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
  const floatingBtn = document.getElementById("floatingCartBtn");
  if (floatingBtn) floatingBtn.style.display = count > 0 ? "block" : "none";
}

export function getCurrentCart() {
  return JSON.parse(localStorage.getItem("recovery_cart") || "[]");
}

export function setCart(cart) {
  localStorage.setItem("recovery_cart", JSON.stringify(cart));
}

window.openCartDrawer = openCartDrawer;
