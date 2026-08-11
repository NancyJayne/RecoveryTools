import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { functions, storage } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";

const updateProduct = httpsCallable(functions, "updateProduct");
const updateInventory = httpsCallable(functions, "updateProductInventory");
const getProducts = httpsCallable(functions, "getFirestoreProducts");
const getAdminAssets = httpsCallable(functions, "getAdminAssets");
const upsertAdminAsset = httpsCallable(functions, "upsertAdminAsset");
const getInventoryOperationsData = httpsCallable(functions, "getInventoryOperationsData");
const updateInventoryStocktake = httpsCallable(functions, "updateInventoryStocktake");
const recordManufacturingRun = httpsCallable(functions, "recordManufacturingRun");
const updateWorkshopAttendance = httpsCallable(functions, "updateWorkshopAttendance");
const managePromotions = httpsCallable(functions, "managePromotions");

let cachedProducts = [];
let cachedAssets = [];
let inventoryOperations = {
  stocktakeRows: [], productionOptions: [], workshopSessions: [], accessSummaries: [],
};
let lastManufacturingPreviewVariantId = "";
let cachedPromotions = [];

function asMoney(value) {
  const amount = Number(value ?? 0);
  return `$${amount.toFixed(2)}`;
}

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getProductImage(product) {
  return product.images?.[0] ||
    product.media?.find((asset) => asset?.type === "image")?.url ||
    product.image ||
    product.imageUrl ||
    "";
}

function productTags(product) {
  return [
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.tagIds) ? product.tagIds : []),
  ];
}

function variantLabel(variant) {
  return variant.name ||
    [variant.colour, variant.size].filter(Boolean).join(" / ") ||
    variant.sku ||
    variant.variantId ||
    variant.id ||
    "Variant";
}

export function setupProductManager() {
  const list = document.getElementById("productList");

  setupProductManagerTools();

  if (list) {
    loadProducts();
  }

  setupAssetManager();
  setupInventoryOperations();
  setupPromotionsManager();

  if (document.body.dataset.productSaveRefreshBound !== "true") {
    document.body.dataset.productSaveRefreshBound = "true";
    window.addEventListener("admin-product-saved", () => {
      loadProducts();
      loadInventoryOperations();
    });
  }

}

function showProductManagerTool(toolName) {
  const panel = document.getElementById("productManagerPanel");
  if (!panel) return;
  panel.dataset.activeTool = toolName;
  panel.querySelectorAll(".product-manager-tool-panel").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.productManagerPanel !== toolName);
  });
  panel.querySelectorAll(".product-manager-tool-btn").forEach((button) => {
    const active = button.dataset.productManagerTool === toolName;
    button.classList.toggle("bg-[#407471]", active);
    button.classList.toggle("border", !active);
    button.classList.toggle("border-gray-600", !active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setupProductManagerTools() {
  const panel = document.getElementById("productManagerPanel");
  if (!panel) return;
  panel.querySelectorAll(".product-manager-tool-btn").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const toolName = button.dataset.productManagerTool || "inventory";
      showProductManagerTool(toolName);
      if (toolName === "inventory" || toolName === "manufacturing") {
        loadInventoryOperations();
      }
      if (toolName === "products") loadProducts();
      if (toolName === "assets") loadAssets();
      if (toolName === "promotions") {
        loadProducts().then(renderPromotionEligibilityOptions);
        loadPromotions();
      }
    });
  });
  showProductManagerTool(panel.dataset.activeTool || "inventory");
}

function selectedValues(select) {
  return [...(select?.selectedOptions || [])].map((option) => option.value).filter(Boolean);
}

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function dateTimeIso(id) {
  const value = document.getElementById(id)?.value || "";
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function renderPromotionEligibilityOptions(selectedProducts = [], selectedVariants = []) {
  const products = document.getElementById("promotionProductIds");
  const variants = document.getElementById("promotionVariantIds");
  if (products) products.innerHTML = cachedProducts.map((product) =>
    `<option value="${escapeHTML(product.id)}"${selectedProducts.includes(product.id) ? " selected" : ""}>` +
    `${escapeHTML(product.name || product.id)}</option>`,
  ).join("");
  if (variants) variants.innerHTML = cachedProducts.flatMap((product) =>
    (product.variants || []).map((variant) => {
      const id = variant.variantId || variant.id;
      return `<option value="${escapeHTML(id)}"${selectedVariants.includes(id) ? " selected" : ""}>` +
        `${escapeHTML(product.name || product.id)} / ${escapeHTML(variantLabel(variant))}</option>`;
    }),
  ).join("");
}

function resetPromotionForm() {
  document.getElementById("promotionForm")?.reset();
  document.getElementById("promotionId").value = "";
  document.getElementById("promotionActive").checked = true;
  document.getElementById("promotionUsesPerCustomer").value = "1";
  renderPromotionEligibilityOptions();
}

function editPromotion(promotion) {
  document.getElementById("promotionId").value = promotion.id || promotion.promotionId || "";
  document.getElementById("promotionCode").value = promotion.code || "";
  document.getElementById("promotionName").value = promotion.name || "";
  document.getElementById("promotionDiscountType").value = promotion.discountType || "percentage";
  document.getElementById("promotionDiscountValue").value = promotion.discountValue ?? "";
  document.getElementById("promotionStartsAt").value = localDateTime(promotion.startsAt);
  document.getElementById("promotionEndsAt").value = localDateTime(promotion.endsAt);
  document.getElementById("promotionMinimumOrder").value = promotion.minimumOrder ?? "";
  document.getElementById("promotionMaxUses").value = promotion.maxUses || "";
  document.getElementById("promotionUsesPerCustomer").value = promotion.usesPerCustomer || 1;
  document.getElementById("promotionAudience").value = promotion.audience || "all";
  document.getElementById("promotionActive").checked = promotion.active !== false;
  document.getElementById("promotionStackable").checked = promotion.stackable === true;
  renderPromotionEligibilityOptions(promotion.productIds || [], promotion.variantIds || []);
}

function renderPromotions() {
  const list = document.getElementById("promotionList");
  if (!list) return;
  list.innerHTML = cachedPromotions.length ? cachedPromotions.map((promotion) => `
    <article class="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-700 p-3">
      <div><p class="font-semibold text-white">${escapeHTML(promotion.code)} - ${escapeHTML(promotion.name)}</p>
        <p class="text-xs text-gray-400">${escapeHTML(promotion.discountType)} ${escapeHTML(promotion.discountValue || "")} / ${promotion.active === false ? "inactive" : "active"} / ${Number(promotion.usageCount || 0)} uses</p></div>
      <div class="flex gap-2"><button type="button" data-edit-promotion="${escapeHTML(promotion.id)}" class="rounded border border-[#407471] px-3 py-1 text-sm">Edit</button><button type="button" data-archive-promotion="${escapeHTML(promotion.id)}" class="rounded border border-red-700 px-3 py-1 text-sm text-red-200">Archive</button></div>
    </article>`).join("") : "<p class=\"text-sm text-gray-400\">No promotions created.</p>";
}

async function loadPromotions() {
  const response = await managePromotions({ action: "list" });
  cachedPromotions = response.data?.promotions || [];
  renderPromotions();
}

function setupPromotionsManager() {
  const form = document.getElementById("promotionForm");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      await managePromotions({ action: "upsert", promotion: {
        id: document.getElementById("promotionId").value,
        code: document.getElementById("promotionCode").value,
        name: document.getElementById("promotionName").value,
        discountType: document.getElementById("promotionDiscountType").value,
        discountValue: document.getElementById("promotionDiscountValue").value,
        startsAt: dateTimeIso("promotionStartsAt"), endsAt: dateTimeIso("promotionEndsAt"),
        minimumOrder: document.getElementById("promotionMinimumOrder").value,
        maxUses: document.getElementById("promotionMaxUses").value,
        usesPerCustomer: document.getElementById("promotionUsesPerCustomer").value,
        audience: document.getElementById("promotionAudience").value,
        productIds: selectedValues(document.getElementById("promotionProductIds")),
        variantIds: selectedValues(document.getElementById("promotionVariantIds")),
        active: document.getElementById("promotionActive").checked,
        stackable: document.getElementById("promotionStackable").checked,
      } });
      showToast("Promotion saved.", "success");
      resetPromotionForm();
      await loadPromotions();
    } catch (error) {
      showToast(error.message || "Unable to save promotion.", "error");
    } finally { submit.disabled = false; }
  });
  document.getElementById("newPromotionBtn")?.addEventListener("click", resetPromotionForm);
  document.getElementById("cancelPromotionBtn")?.addEventListener("click", resetPromotionForm);
  document.getElementById("promotionList")?.addEventListener("click", async (event) => {
    const editId = event.target.closest("[data-edit-promotion]")?.dataset.editPromotion;
    if (editId) editPromotion(cachedPromotions.find((item) => item.id === editId) || {});
    const archiveId = event.target.closest("[data-archive-promotion]")?.dataset.archivePromotion;
    if (archiveId && window.confirm("Archive this promotion code?")) {
      await managePromotions({ action: "archive", promotionId: archiveId });
      await loadPromotions();
    }
  });
}

function setupInventoryOperations() {
  const list = document.getElementById("inventoryStocktakeList");
  if (!list) return;
  const refresh = document.getElementById("refreshInventoryOperationsBtn");
  const search = document.getElementById("inventoryStocktakeSearch");
  const save = document.getElementById("saveInventoryStocktakeBtn");
  const productSelect = document.getElementById("manufacturingProductSelect");
  const variantSelect = document.getElementById("manufacturingVariantSelect");
  const record = document.getElementById("recordManufacturingRunBtn");
  if (refresh?.dataset.bound !== "true") {
    refresh.dataset.bound = "true";
    refresh.addEventListener("click", loadInventoryOperations);
    search?.addEventListener("input", renderStocktakeList);
    save?.addEventListener("click", saveStocktake);
    productSelect?.addEventListener("change", renderManufacturingVariants);
    variantSelect?.addEventListener("change", renderManufacturingPreview);
    document.getElementById("manufacturingQuantityProduced")
      ?.addEventListener("input", renderManufacturingPreview);
    record?.addEventListener("click", submitManufacturingRun);
  }
  loadInventoryOperations();
}

async function loadInventoryOperations() {
  const list = document.getElementById("inventoryStocktakeList");
  if (list) list.textContent = "Loading inventory...";
  try {
    const result = await getInventoryOperationsData({});
    inventoryOperations = {
      stocktakeRows: Array.isArray(result.data?.stocktakeRows) ? result.data.stocktakeRows : [],
      productionOptions: Array.isArray(result.data?.productionOptions) ? result.data.productionOptions : [],
      workshopSessions: Array.isArray(result.data?.workshopSessions) ? result.data.workshopSessions : [],
      accessSummaries: Array.isArray(result.data?.accessSummaries) ? result.data.accessSummaries : [],
    };
    renderStocktakeList();
    renderManufacturingOptions();
    renderWorkshopSessions();
    if (document.getElementById("productList")) renderProductManagerList(cachedProducts);
  } catch (error) {
    console.error("Failed to load inventory operations:", error);
    if (list) list.textContent = "Inventory could not be loaded.";
    showToast("Failed to load inventory operations", "error");
  }
}

function workshopDate(value) {
  if (!value) return "Date not set";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Australia/Brisbane",
    }).format(date);
}

function renderWorkshopSessions() {
  const list = document.getElementById("workshopSessionList");
  if (!list) return;
  const search = normalized(document.getElementById("workshopSessionSearch")?.value);
  const sessions = inventoryOperations.workshopSessions.filter((session) =>
    !search || [
      session.productName, session.variantName, session.eventLocation,
      session.instructor, session.productId, session.productVariantId,
    ].join(" ").toLowerCase().includes(search));
  if (!sessions.length) {
    list.textContent = "No Workshop Product sessions match this search.";
    return;
  }
  list.innerHTML = sessions.map((session) => {
    const capacity = Number(session.capacity || 0);
    const remaining = session.remaining === null ? "Not limited" : session.remaining;
    const attendeeRows = session.attendees.length
      ? session.attendees.map((attendee) => `
          <tr class="border-t border-gray-800 ${attendee.removed ? "opacity-70" : ""}">
            <td class="px-2 py-2">${escapeHTML(attendee.name)}</td>
            <td class="px-2 py-2">${escapeHTML(attendee.email || "No email")}</td>
            <td class="px-2 py-2">${attendee.quantity}</td>
            <td class="px-2 py-2">
              <span class="rounded px-2 py-1 text-xs ${attendee.removed ? "bg-purple-900/70 text-purple-200" : "bg-green-900/60 text-green-200"}">
                ${attendee.removed ? "Removed" : "Active"}
              </span>
            </td>
            <td class="px-2 py-2 text-xs text-gray-300">
              ${escapeHTML(attendee.removalReason || "-")}
            </td>
            <td class="px-2 py-2">
              <a class="text-purple-300 hover:underline"
                href="/admin/orders?filter=${encodeURIComponent(attendee.orderId)}">Open order</a>
            </td>
          </tr>`).join("")
      : `<tr><td colspan="6" class="px-2 py-3 text-gray-400">No attendee history yet.</td></tr>`;
    return `
      <details class="mb-3 overflow-hidden rounded border border-gray-700 bg-gray-950/40">
        <summary class="cursor-pointer p-4 hover:bg-gray-900/70">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 class="font-semibold text-white">${escapeHTML(session.productName)}</h4>
              <p class="text-sm text-gray-300">${escapeHTML(session.variantName)}</p>
              <p class="text-xs text-gray-400">
                ${escapeHTML(workshopDate(session.eventStartAt))}
                ${session.eventLocation ? ` · ${escapeHTML(session.eventLocation)}` : ""}
              </p>
            </div>
            <div class="grid grid-cols-3 gap-4 text-center text-sm">
              <span><strong class="block text-white">${capacity || "—"}</strong>Capacity</span>
              <span><strong class="block text-white">${session.sold}</strong>Sold</span>
              <span><strong class="block text-white">${remaining}</strong>Remaining</span>
            </div>
          </div>
        </summary>
        <div class="border-t border-gray-700 p-4">
          <p class="mb-2 text-xs text-gray-400">
            ${escapeHTML(session.productVariantId || session.productId)}
            ${session.instructor ? ` · Instructor: ${escapeHTML(session.instructor)}` : ""}
          </p>
          <div class="max-w-full overflow-x-auto">
            <table class="w-full min-w-[760px] text-sm">
              <thead><tr class="text-left text-xs uppercase text-gray-400">
                <th class="px-2 py-2">Attendee</th><th class="px-2 py-2">Email</th>
                <th class="px-2 py-2">Tickets</th><th class="px-2 py-2">Status</th>
                <th class="px-2 py-2">Reason</th><th class="px-2 py-2">Order</th>
              </tr></thead>
              <tbody>${attendeeRows}</tbody>
            </table>
          </div>
        </div>
      </details>`;
  }).join("");
}

function createWorkshopSessionsPanel(product) {
  const productId = product.id || product.productId || "";
  const sessions = inventoryOperations.workshopSessions
    .filter((session) => session.productId === productId);
  if (!sessions.length) return null;
  const panel = document.createElement("section");
  panel.className = "mt-4 min-w-0 max-w-full overflow-hidden rounded border border-gray-700 bg-gray-900/70 p-3";
  panel.innerHTML = `
    <h4 class="text-sm font-semibold text-white">Workshop sessions</h4>
    <p class="mb-3 text-xs text-gray-400">Ticket totals and on-the-day attendee check-in for each Product variant.</p>
    ${sessions.map((session) => {
    const capacity = Number(session.capacity || 0);
    const remaining = session.remaining === null ? "Not limited" : session.remaining;
    const attendeeRows = session.attendees.length
      ? session.attendees.map((attendee) => `
          <tr class="border-t border-gray-800 ${attendee.removed ? "opacity-70" : ""}">
            <td class="px-2 py-2"><input type="checkbox"
              class="workshop-attendance-checkbox accent-[#407471]"
              data-product-id="${escapeHTML(session.productId)}"
              data-product-variant-id="${escapeHTML(session.productVariantId || "")}"
              data-order-id="${escapeHTML(attendee.orderId)}"
              data-user-id="${escapeHTML(attendee.userId || "")}"
              ${attendee.checkedIn ? "checked" : ""}
              ${attendee.removed ? "disabled" : ""}
              aria-label="Check in ${escapeHTML(attendee.name)}"></td>
            <td class="px-2 py-2">${escapeHTML(attendee.name)}</td>
            <td class="px-2 py-2">${escapeHTML(attendee.email || "No email")}</td>
            <td class="px-2 py-2">${attendee.quantity}</td>
            <td class="px-2 py-2">
              <span class="rounded px-2 py-1 text-xs ${attendee.removed ? "bg-purple-900/70 text-purple-200" : "bg-green-900/60 text-green-200"}">
                ${attendee.removed ? "Removed" : "Active"}
              </span>
            </td>
            <td class="px-2 py-2 text-xs text-gray-300">
              ${escapeHTML(attendee.removalReason || "-")}
            </td>
            <td class="px-2 py-2"><a class="text-purple-300 hover:underline"
              href="/admin/orders?filter=${encodeURIComponent(attendee.orderId)}">Open order</a></td>
          </tr>`).join("")
      : `<tr><td colspan="7" class="px-2 py-3 text-gray-400">No attendee history yet.</td></tr>`;
    return `
      <details class="mb-3 overflow-hidden rounded border border-gray-700 bg-gray-950/40">
        <summary class="cursor-pointer p-4 hover:bg-gray-900/70">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="font-semibold text-white">${escapeHTML(session.variantName)}</p>
              <p class="text-xs text-gray-400">${escapeHTML(workshopDate(session.eventStartAt))}${session.eventLocation ? ` · ${escapeHTML(session.eventLocation)}` : ""}</p>
              ${session.instructor ? `<p class="text-xs text-gray-400">Instructor: ${escapeHTML(session.instructor)}</p>` : ""}
            </div>
            <div class="grid grid-cols-3 gap-4 text-center text-sm">
              <span><strong class="block text-white">${capacity || "—"}</strong>Capacity</span>
              <span><strong class="block text-white">${session.sold}</strong>Sold</span>
              <span><strong class="block text-white">${remaining}</strong>Remaining</span>
            </div>
          </div>
        </summary>
        <div class="border-t border-gray-700 p-4">
          <div class="max-w-full overflow-x-auto"><table class="w-full min-w-[860px] text-sm">
            <thead><tr class="text-left text-xs uppercase text-gray-400">
              <th class="px-2 py-2">Arrived</th><th class="px-2 py-2">Attendee</th>
              <th class="px-2 py-2">Email</th><th class="px-2 py-2">Tickets</th>
              <th class="px-2 py-2">Status</th><th class="px-2 py-2">Reason</th>
              <th class="px-2 py-2">Order</th>
            </tr></thead><tbody>${attendeeRows}</tbody>
          </table></div>
        </div>
      </details>`;
  }).join("")}`;
  panel.querySelectorAll(".workshop-attendance-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const previous = !checkbox.checked;
      checkbox.disabled = true;
      try {
        await updateWorkshopAttendance({
          productId: checkbox.dataset.productId,
          productVariantId: checkbox.dataset.productVariantId,
          orderId: checkbox.dataset.orderId,
          userId: checkbox.dataset.userId,
          checkedIn: checkbox.checked,
        });
        showToast(checkbox.checked ? "Attendee checked in" : "Attendee check-in removed", "success");
      } catch (error) {
        checkbox.checked = previous;
        console.error("Failed to update Workshop attendance:", error);
        showToast("Failed to update attendee check-in", "error");
      } finally {
        checkbox.disabled = false;
      }
    });
  });
  return panel;
}

function createCourseAccessPanel(product) {
  const productId = product.id || product.productId || "";
  const summary = inventoryOperations.accessSummaries.find((entry) => entry.productId === productId);
  const type = normalized(`${product.productType || ""} ${product.type || ""} ${product.itemType || ""}`);
  if (!summary && !type.includes("course")) return null;
  const users = summary?.unlockedUsers || [];
  const panel = document.createElement("section");
  panel.className = "mt-4 rounded border border-gray-700 bg-gray-900/70 p-3";
  panel.innerHTML = `
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 class="text-sm font-semibold text-white">Course access</h4>
        <p class="text-xs text-gray-400">Purchases and currently unlocked users.</p>
      </div>
      <div class="grid grid-cols-2 gap-4 text-center text-sm">
        <span><strong class="block text-white">${Number(summary?.purchased || 0)}</strong>Purchased</span>
        <span><strong class="block text-white">${users.length}</strong>Unlocked</span>
      </div>
    </div>
    <details class="mt-3 overflow-hidden rounded border border-gray-700 bg-gray-950/40">
      <summary class="cursor-pointer px-3 py-2 text-sm font-medium text-white hover:bg-gray-900/70">View unlocked users</summary>
      <div class="overflow-x-auto border-t border-gray-700 p-3">
        <table class="min-w-full text-sm">
          <thead><tr class="text-left text-xs uppercase text-gray-400">
            <th class="px-2 py-2">User</th><th class="px-2 py-2">Email</th><th class="px-2 py-2">Access</th>
          </tr></thead>
          <tbody>${users.length ? users.map((user) => `
            <tr class="border-t border-gray-800">
              <td class="px-2 py-2">${escapeHTML(user.name)}</td>
              <td class="px-2 py-2">${escapeHTML(user.email || "No email")}</td>
              <td class="px-2 py-2">${escapeHTML(user.accessId || "Unlocked")}</td>
            </tr>`).join("") : `
            <tr><td colspan="3" class="px-2 py-3 text-gray-400">No active course access yet.</td></tr>`}</tbody>
        </table>
      </div>
    </details>`;
  return panel;
}

function renderStocktakeList() {
  const list = document.getElementById("inventoryStocktakeList");
  if (!list) return;
  const search = normalized(document.getElementById("inventoryStocktakeSearch")?.value);
  const rows = inventoryOperations.stocktakeRows.filter((row) =>
    !search || [
      row.entityType, row.entityId, row.itemVariantId, row.productId, row.name, row.variantName,
    ].join(" ").toLowerCase().includes(search));
  if (!rows.length) {
    list.textContent = "No tracked inventory matches this search.";
    return;
  }
  const groups = new Map();
  rows.forEach((row) => {
    const isItem = ["Item", "ItemVariant"].includes(row.entityType);
    const key = `${isItem ? "Item" : "Product"}:${isItem ? row.entityId : row.productId || row.entityId}`;
    const group = groups.get(key) || {
      kind: isItem ? "Item" : "Product",
      name: row.name,
      id: isItem ? row.entityId : row.productId || row.entityId,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  });
  const groupRows = [...groups.values()].map((group) => {
    const total = group.rows.reduce((sum, row) => sum + Number(row.stock || 0), 0);
    const stockRows = group.rows.map((row) => `
      <tr class="border-b border-gray-800" data-stocktake-row
        data-inventory-id="${escapeHTML(row.inventoryId)}"
        data-entity-type="${escapeHTML(row.entityType)}"
        data-entity-id="${escapeHTML(row.entityId)}"
        data-item-variant-id="${escapeHTML(row.itemVariantId || "")}"
        data-product-id="${escapeHTML(row.productId || "")}">
        <td class="px-2 py-2 pl-6">
          <div class="font-medium text-white">${escapeHTML(row.variantName || "Default")}</div>
          <div class="text-xs text-gray-500">${escapeHTML(row.itemVariantId || row.entityId)}</div>
        </td>
        <td class="px-2 py-2 text-gray-300">${escapeHTML(row.unit || "each")}</td>
        <td class="px-2 py-2">
          <input type="number" min="0" step="1" value="${Number(row.stock || 0)}"
            class="stocktake-quantity input w-28" aria-label="Counted stock for ${escapeHTML(row.name)}">
        </td>
      </tr>
    `).join("");
    return `
      <tr class="border-y border-gray-700 bg-gray-900/80">
        <th colspan="3" class="px-2 py-3 text-left">
          <span class="font-semibold text-white">${escapeHTML(group.kind)}: ${escapeHTML(group.name)}</span>
          <span class="ml-2 text-xs font-normal text-gray-400">${escapeHTML(group.id)} · total ${total}</span>
        </th>
      </tr>
      ${stockRows}
    `;
  }).join("");
  list.innerHTML = `
    <table class="min-w-full border-collapse">
      <thead><tr class="border-b border-gray-700 text-left text-xs uppercase tracking-wide text-gray-400">
        <th class="px-2 py-2">Variant</th><th class="px-2 py-2">Unit</th>
        <th class="px-2 py-2">Counted stock</th>
      </tr></thead>
      <tbody>${groupRows}</tbody>
    </table>
  `;
}

async function saveStocktake() {
  const button = document.getElementById("saveInventoryStocktakeBtn");
  const rows = [...document.querySelectorAll("[data-stocktake-row]")].map((row) => ({
    inventoryId: row.dataset.inventoryId,
    entityType: row.dataset.entityType,
    entityId: row.dataset.entityId,
    itemVariantId: row.dataset.itemVariantId,
    productId: row.dataset.productId,
    stock: Number(row.querySelector(".stocktake-quantity")?.value),
  }));
  if (!rows.length) return showToast("No inventory rows are shown.", "error");
  try {
    button.disabled = true;
    button.textContent = "Saving...";
    await updateInventoryStocktake({ rows });
    showToast(`Stocktake saved for ${rows.length} records`, "success");
    await loadInventoryOperations();
    await loadProducts();
  } catch (error) {
    console.error("Failed to save stocktake:", error);
    showToast(error.message || "Failed to save stocktake", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Save stocktake";
  }
}

function renderManufacturingOptions() {
  const select = document.getElementById("manufacturingProductSelect");
  if (!select) return;
  const current = select.value;
  const products = [...new Map(inventoryOperations.productionOptions.map((option) => [
    option.productId,
    option.productName,
  ])).entries()];
  select.innerHTML = `<option value="">Choose a Product</option>` +
    products.map(([productId, productName]) => `
      <option value="${escapeHTML(productId)}">${escapeHTML(productName)}</option>
    `).join("");
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  renderManufacturingVariants();
}

function renderManufacturingVariants() {
  const productId = document.getElementById("manufacturingProductSelect")?.value || "";
  const select = document.getElementById("manufacturingVariantSelect");
  if (!select) return;
  const previous = select.value;
  const variants = inventoryOperations.productionOptions
    .filter((option) => option.productId === productId);
  select.disabled = !productId;
  select.innerHTML = productId
    ? `<option value="">Choose a Product variant</option>` + variants.map((option) => `
      <option value="${escapeHTML(option.productVariantId || "__DEFAULT__")}">
        ${escapeHTML(option.variantName || "Default")}
      </option>
    `).join("")
    : `<option value="">Choose a Product first</option>`;
  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  } else if (variants.length === 1) {
    select.value = variants[0].productVariantId || "__DEFAULT__";
  }
  renderManufacturingPreview();
}

function selectedManufacturingOption() {
  const value = document.getElementById("manufacturingVariantSelect")?.value;
  const productId = document.getElementById("manufacturingProductSelect")?.value || "";
  if (!value || !productId) return null;
  return inventoryOperations.productionOptions.find((option) =>
    option.productId === productId &&
    (option.productVariantId || "__DEFAULT__") === value) || null;
}

function preferredComponentVariant(component, finishedVariantName) {
  if (!Array.isArray(component.variants) || !component.variants.length) return null;
  const finishedTokens = new Set(normalized(finishedVariantName).split(/[^a-z0-9]+/).filter((token) =>
    token.length > 1));
  return [...component.variants].sort((left, right) => {
    const score = (variant) => normalized(variant.name).split(/[^a-z0-9]+/)
      .filter((token) => finishedTokens.has(token)).length;
    return score(right) - score(left);
  })[0];
}

function renderManufacturingPreview() {
  const preview = document.getElementById("manufacturingRecipePreview");
  if (!preview) return;
  const option = selectedManufacturingOption();
  if (!option) {
    lastManufacturingPreviewVariantId = "";
    preview.textContent = "Choose a Product and variant to preview its Blueprint recipe.";
    return;
  }
  const finishedVariantId = option.productVariantId || "__DEFAULT__";
  const finishedVariantChanged = finishedVariantId !== lastManufacturingPreviewVariantId;
  const produced = Math.max(0, Number(document.getElementById("manufacturingQuantityProduced")?.value || 0));
  const componentRows = option.components.map((component) => {
    const required = Number(component.quantity || 0) * produced;
    const existingSelection = finishedVariantChanged
      ? ""
      : document.querySelector(
        `.manufacturing-component-variant[data-component-id="${CSS.escape(component.componentId)}"]`,
      )?.value;
    const storedVariant = component.variants?.find((variant) =>
      variant.itemVariantId === component.itemVariantId);
    const preferred = storedVariant || component.variants?.find((variant) =>
      variant.itemVariantId === existingSelection) ||
      preferredComponentVariant(component, option.variantName);
    const available = preferred ? Number(preferred.stock || 0) : Number(component.stock || 0);
    const enough = available >= required;
    const variantSelector = storedVariant
      ? `<div class="mt-1 text-xs text-[#9edbd7]">
          Uses ${escapeHTML(storedVariant.name)} from the saved Blueprint recipe
        </div>`
      : component.variants?.length
        ? `<select class="manufacturing-component-variant input mt-2 w-full"
          data-component-id="${escapeHTML(component.componentId)}"
          data-item-id="${escapeHTML(component.itemId)}">
          ${component.variants.map((variant) => `
            <option value="${escapeHTML(variant.itemVariantId)}"
              ${variant.itemVariantId === preferred?.itemVariantId ? "selected" : ""}>
              ${escapeHTML(variant.name)} — ${Number(variant.stock || 0)} available
            </option>
          `).join("")}
        </select>`
        : "";
    return `<li class="${enough ? "text-gray-300" : "text-red-300"}">
      <div>
        ${required} ${escapeHTML(component.unit)} ${escapeHTML(component.name)}
        <span class="text-xs">(selected stock: ${available}; all variants: ${Number(component.stock || 0)})</span>
      </div>
      ${variantSelector}
    </li>`;
  }).join("");
  preview.innerHTML = `
    <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Manufacturing recipe</div>
    <div class="mb-2 text-sm font-semibold text-white">
      Finished variant: ${escapeHTML(option.variantName || "Default")}
    </div>
    <div class="font-semibold text-white">${escapeHTML(option.blueprintName)}</div>
    ${option.blueprintVariantName
    ? `<div class="text-sm text-[#9edbd7]">
        Recipe variant: ${escapeHTML(option.blueprintVariantName)}
        ${Number(option.blueprintVariantCount || 0) === 1 ? " (shared by all Product variants)" : ""}
      </div>`
    : ""}
    <div class="mb-2 text-xs text-gray-400">${escapeHTML(option.blueprintId)}</div>
    <ul class="space-y-1">${componentRows}</ul>
  `;
  preview.querySelectorAll(".manufacturing-component-variant").forEach((select) => {
    select.addEventListener("change", renderManufacturingPreview);
  });
  lastManufacturingPreviewVariantId = finishedVariantId;
}

async function submitManufacturingRun() {
  const option = selectedManufacturingOption();
  const quantityProduced = Number(document.getElementById("manufacturingQuantityProduced")?.value);
  if (!option) return showToast("Choose a Product and Product variant.", "error");
  if (!Number.isInteger(quantityProduced) || quantityProduced <= 0) {
    return showToast("Enter a whole quantity greater than zero.", "error");
  }
  const button = document.getElementById("recordManufacturingRunBtn");
  try {
    button.disabled = true;
    button.textContent = "Recording...";
    await recordManufacturingRun({
      productId: option.productId,
      productVariantId: option.productVariantId,
      blueprintId: option.blueprintId,
      blueprintVariantId: option.blueprintVariantId,
      quantityProduced,
      componentSelections: [...document.querySelectorAll(".manufacturing-component-variant")]
        .map((select) => ({
          componentId: select.dataset.componentId,
          itemId: select.dataset.itemId,
          itemVariantId: select.value,
        })),
    });
    const completedProductId = option.productId;
    showToast(`Production recorded: ${quantityProduced} added`, "success");
    document.getElementById("manufacturingQuantityProduced").value = "0";
    await loadInventoryOperations();
    const productSelect = document.getElementById("manufacturingProductSelect");
    const variantSelect = document.getElementById("manufacturingVariantSelect");
    if (productSelect) productSelect.value = completedProductId;
    renderManufacturingVariants();
    if (variantSelect) variantSelect.value = "";
    renderManufacturingPreview();
    await loadProducts();
  } catch (error) {
    console.error("Failed to record manufacturing:", error);
    showToast(error.message || "Failed to record manufacturing", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Record production";
  }
}

export function setupContentControls() {
  const section = document.getElementById("adminContentControlsSection");
  if (!section) return;

  if (section.dataset.bound !== "true") {
    section.dataset.bound = "true";
    [
      "contentControlsSearch",
      "contentControlsTypeFilter",
      "contentControlsVisibilityFilter",
      "contentControlsInventoryFilter",
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", renderContentControls);
      document.getElementById(id)?.addEventListener("change", renderContentControls);
    });

    document.getElementById("refreshContentControlsBtn")?.addEventListener("click", () => {
      loadProducts({ renderManager: false, renderControls: true });
    });
  }

  loadProducts({ renderManager: false, renderControls: true });
}

async function loadProducts({ renderManager = true, renderControls = true } = {}) {
  const container = document.getElementById("productList");

  if (container && renderManager) {
    container.textContent = "Loading products...";
  }
  const controlsList = document.getElementById("contentControlsList");
  if (controlsList && renderControls) {
    controlsList.textContent = "Loading content controls...";
  }

  const res = await getProducts({ includeHidden: true });
  const products = Array.isArray(res.data?.products) ? res.data.products : [];
  cachedProducts = products;

  if (container && renderManager) {
    renderProductManagerList(products);
    openRequestedProductEdit(products);
  }

  if (controlsList && renderControls) {
    renderContentControls();
  }
}

function renderProductManagerList(products) {
  const container = document.getElementById("productList");
  if (!container) return;
  container.textContent = "";

  products.forEach((p) => {
    const div = document.createElement("div");
    div.className = "min-w-0 max-w-full overflow-hidden rounded border border-gray-700 bg-gray-800 p-4 shadow";

    const row = document.createElement("div");
    row.className = "min-w-0 max-w-full overflow-hidden flex flex-col gap-4 md:flex-row md:items-start";

    const imageUrl = getProductImage(p);
    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = p.name || p.title || "Product image";
      img.className = "w-20 h-20 object-cover rounded bg-gray-900";
      row.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "min-w-0 max-w-full flex-1 overflow-hidden";

    const title = document.createElement("h3");
    title.className = "text-lg font-bold mb-1";
    title.textContent = p.name || p.title || p.id;

    const meta = document.createElement("p");
    meta.className = "text-sm";
    meta.textContent = [
      asMoney(p.price ?? p.priceFrom),
      p.type || "unknown",
      p.inventoryTracked ? `Stock: ${p.stock ?? 0}` : "",
      `Status: ${p.shopStatus || (p.visible ? "active" : "hidden")}`,
      p.visible ? "Visible" : "Hidden",
    ].filter(Boolean).join(" | ");

    const tags = document.createElement("p");
    tags.className = "text-sm text-gray-400";
    tags.textContent = `Tags: ${productTags(p).join(", ") || "None"}`;

    const description = document.createElement("p");
    description.className = "text-sm text-gray-300 mt-1";
    description.textContent = p.shortDescription || p.longDescription || "";

    const btn = document.createElement("button");
    btn.className = "edit-btn mt-2 px-3 py-1 rounded bg-blue-600 text-white";
    btn.textContent = "Edit";
    btn.dataset.product = JSON.stringify(p);

    btn.addEventListener("click", () => openProductEditor(JSON.parse(btn.dataset.product)));

    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(tags);
    body.appendChild(description);
    body.appendChild(btn);

    const actions = document.createElement("div");
    actions.className = "mt-3 flex flex-wrap gap-2";
    [
      { label: "Activate", status: "active", visible: true, archived: false },
      { label: "Hide", status: "draft", visible: false, archived: false },
      { label: "Archive", status: "archived", visible: false, archived: true },
    ].forEach((action) => {
      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "rounded bg-gray-700 px-3 py-1 text-sm text-white hover:bg-gray-600";
      actionBtn.textContent = action.label;
      actionBtn.addEventListener("click", async () => {
        try {
          await updateProduct({
            id: p.id,
            updates: {
              shopStatus: action.status,
              visible: action.visible,
              websiteVisible: action.visible,
              archived: action.archived,
            },
          });
          showToast(`Product status set to ${action.status}`, "success");
          loadProducts();
        } catch (err) {
          console.error("Failed to update product status:", err);
          showToast("Failed to update product status", "error");
        }
      });
      actions.appendChild(actionBtn);
    });
    body.appendChild(actions);

    const workshopPanel = createWorkshopSessionsPanel(p);
    if (workshopPanel) body.appendChild(workshopPanel);

    const courseAccessPanel = createCourseAccessPanel(p);
    if (courseAccessPanel) body.appendChild(courseAccessPanel);

    if (p.inventoryTracked === true) {
      const inventoryPanel = document.createElement("div");
      inventoryPanel.className = "mt-4 rounded border border-gray-700 bg-gray-900/70 p-3";

      const inventoryHeading = document.createElement("div");
      inventoryHeading.className = "mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between";
      inventoryHeading.innerHTML = `
      <div>
        <h4 class="text-sm font-semibold text-white">Inventory</h4>
        <p class="text-xs text-gray-400">
          ${p.inventoryTracked ? "Stock is tracked for this product." : "Stock is not tracked for this product yet."}
        </p>
      </div>
    `;
      inventoryPanel.appendChild(inventoryHeading);

      const stockGrid = document.createElement("div");
      stockGrid.className = "grid gap-3 md:grid-cols-2";

      if (Array.isArray(p.variants) && p.variants.length) {
        p.variants.forEach((variant) => {
          const field = document.createElement("label");
          field.className = "block text-sm text-gray-300";
          field.innerHTML = `
          <span class="mb-1 block">${variantLabel(variant)}</span>
          <input
            type="number"
            min="0"
            step="1"
            class="variant-stock-input input w-full"
            data-variant-id="${variant.variantId || variant.id}"
            value="${Number(variant.stock ?? 0)}"
          >
        `;
          stockGrid.appendChild(field);
        });
      } else {
        const field = document.createElement("label");
        field.className = "block text-sm text-gray-300";
        field.innerHTML = `
        <span class="mb-1 block">Stock quantity</span>
        <input
          type="number"
          min="0"
          step="1"
          class="product-stock-input input w-full"
          value="${Number(p.stock ?? 0)}"
        >
      `;
        stockGrid.appendChild(field);
      }

      const saveInventoryBtn = document.createElement("button");
      saveInventoryBtn.type = "button";
      saveInventoryBtn.className = [
        "mt-3 rounded bg-[#407471] px-3 py-2 text-sm font-semibold text-white",
        "hover:bg-[#305a56]",
      ].join(" ");
      saveInventoryBtn.textContent = "Save inventory";
      saveInventoryBtn.addEventListener("click", async () => {
        const variantInputs = [...inventoryPanel.querySelectorAll(".variant-stock-input")];
        const stockInput = inventoryPanel.querySelector(".product-stock-input");
        const variants = variantInputs.map((input) => ({
          variantId: input.dataset.variantId,
          stock: Number(input.value || 0),
        }));
        const stock = stockInput
          ? Number(stockInput.value || 0)
          : variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);

        try {
          saveInventoryBtn.disabled = true;
          saveInventoryBtn.textContent = "Saving...";
          await updateInventory({
            productId: p.id,
            stock,
            variants,
          });
          showToast("Inventory updated", "success");
          loadProducts();
        } catch (err) {
          console.error("Failed to update inventory:", err);
          showToast("Failed to update inventory", "error");
        } finally {
          saveInventoryBtn.disabled = false;
          saveInventoryBtn.textContent = "Save inventory";
        }
      });

      inventoryPanel.appendChild(stockGrid);
      inventoryPanel.appendChild(saveInventoryBtn);
      body.appendChild(inventoryPanel);
    }

    row.appendChild(body);
    div.appendChild(row);
    container.appendChild(div);
  });

}

function normalized(value) {
  return String(value || "").toLowerCase().trim();
}

function productVisibility(product) {
  if (product.archived === true || product.shopStatus === "archived") return "archived";
  return product.visible === true ? "visible" : "hidden";
}

function productSearchText(product) {
  return [
    product.id,
    product.productId,
    product.itemId,
    product.name,
    product.title,
    product.sku,
    product.type,
    product.itemType,
    product.itemKind,
    product.categoryId,
    product.shopStatus,
    ...productTags(product),
  ].join(" ").toLowerCase();
}

function contentControlFilters() {
  return {
    search: normalized(document.getElementById("contentControlsSearch")?.value),
    type: document.getElementById("contentControlsTypeFilter")?.value || "all",
    visibility: document.getElementById("contentControlsVisibilityFilter")?.value || "all",
    inventory: document.getElementById("contentControlsInventoryFilter")?.value || "all",
  };
}

function matchesInventoryFilter(product, filter) {
  const tracked = product.inventoryTracked === true;
  const stock = Number(product.stock ?? 0);
  if (filter === "tracked") return tracked;
  if (filter === "not-tracked") return !tracked;
  if (filter === "low-stock") return tracked && stock > 0 && stock <= 5;
  if (filter === "out-of-stock") return tracked && stock <= 0;
  return true;
}

function filteredContentProducts() {
  const filters = contentControlFilters();
  return cachedProducts.filter((product) => {
    if (filters.search && !productSearchText(product).includes(filters.search)) return false;
    if (filters.type !== "all" && normalized(product.type) !== filters.type) return false;
    if (filters.visibility !== "all" && productVisibility(product) !== filters.visibility) return false;
    return matchesInventoryFilter(product, filters.inventory);
  });
}

function visibilityBadgeClass(product) {
  const visibility = productVisibility(product);
  if (visibility === "visible") return "bg-green-900/60 text-green-200";
  if (visibility === "archived") return "bg-gray-700 text-gray-200";
  return "bg-yellow-900/60 text-yellow-100";
}

function renderContentControls() {
  const list = document.getElementById("contentControlsList");
  const summary = document.getElementById("contentControlsSummary");
  if (!list) return;

  const products = filteredContentProducts();
  if (summary) {
    summary.textContent = `${products.length} of ${cachedProducts.length} records shown`;
  }

  if (!products.length) {
    list.textContent = "No records match these filters.";
    return;
  }

  list.innerHTML = "";
  products.forEach((product) => {
    const card = document.createElement("article");
    card.className = "rounded border border-gray-700 bg-gray-900/50 p-4";

    const imageUrl = getProductImage(product);
    const productName = product.name || product.title || product.id;
    const productId = product.id || product.productId || "";
    const description = product.shortDescription || product.longDescription || "";
    const inventoryLabel = product.inventoryTracked ? "Tracked" : "Not tracked";
    card.innerHTML = `
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
        ${imageUrl ? `
          <img src="${escapeHTML(imageUrl)}" alt="" class="h-20 w-20 rounded bg-gray-950 object-cover">
        ` : ""}
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="break-words text-lg font-semibold text-white">${escapeHTML(productName)}</h3>
              <p class="break-all text-xs text-gray-400">${escapeHTML(productId)}</p>
            </div>
            <span class="rounded px-2 py-1 text-xs font-semibold ${visibilityBadgeClass(product)}">
              ${escapeHTML(productVisibility(product))}
            </span>
          </div>
          <div class="mt-3 grid gap-2 text-xs text-gray-400 sm:grid-cols-2 xl:grid-cols-4">
            <div><strong class="text-gray-300">Type:</strong> ${escapeHTML(product.type || "unknown")}</div>
            <div><strong class="text-gray-300">Price:</strong> ${asMoney(product.price ?? product.priceFrom)}</div>
            <div><strong class="text-gray-300">Stock:</strong> ${Number(product.stock ?? 0)}</div>
            <div><strong class="text-gray-300">Inventory:</strong> ${escapeHTML(inventoryLabel)}</div>
          </div>
          <p class="mt-2 line-clamp-2 text-sm text-gray-300">${escapeHTML(description)}</p>
          <div class="content-control-actions mt-4 flex flex-wrap gap-2"></div>
          <div class="content-control-inventory mt-4"></div>
        </div>
      </div>
    `;

    const actions = card.querySelector(".content-control-actions");
    [
      { label: "Show", status: "active", visible: true, archived: false },
      { label: "Hide", status: "draft", visible: false, archived: false },
      { label: "Archive", status: "archived", visible: false, archived: true },
    ].forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600";
      button.textContent = action.label;
      button.addEventListener("click", async () => {
        await updateProductStatus(product, action);
      });
      actions.appendChild(button);
    });

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "rounded border border-gray-600 px-3 py-2 text-sm text-white hover:border-[#407471]";
    editButton.textContent = "Open edit panel";
    editButton.addEventListener("click", () => openProductEditor(product));
    actions.appendChild(editButton);

    renderInlineInventory(card.querySelector(".content-control-inventory"), product);
    list.appendChild(card);
  });
}

function renderInlineInventory(container, product) {
  if (!container) return;
  container.className = "content-control-inventory mt-4 rounded border border-gray-800 bg-gray-950/50 p-3";
  container.innerHTML = `
    <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Inventory quick edit</div>
  `;

  const grid = document.createElement("div");
  grid.className = "grid gap-3 md:grid-cols-2";

  if (Array.isArray(product.variants) && product.variants.length) {
    product.variants.forEach((variant) => {
      const label = document.createElement("label");
      label.className = "block text-sm text-gray-300";
      const currentVariantId = variant.variantId || variant.id;
      label.innerHTML = `
        <span class="mb-1 block">${escapeHTML(variantLabel(variant))}</span>
        <input
          type="number"
          min="0"
          step="1"
          class="variant-stock-input input w-full"
          data-variant-id="${escapeHTML(currentVariantId)}"
          value="${Number(variant.stock ?? 0)}"
        >
      `;
      grid.appendChild(label);
    });
  } else {
    const label = document.createElement("label");
    label.className = "block text-sm text-gray-300";
    label.innerHTML = `
      <span class="mb-1 block">Stock quantity</span>
      <input
        type="number"
        min="0"
        step="1"
        class="product-stock-input input w-full"
        value="${Number(product.stock ?? 0)}"
      >
    `;
    grid.appendChild(label);
  }

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "mt-3 rounded bg-[#407471] px-3 py-2 text-sm font-semibold text-white hover:bg-[#305a56]";
  saveButton.textContent = "Save inventory";
  saveButton.addEventListener("click", async () => {
    await saveInventory(container, product, saveButton);
  });

  container.appendChild(grid);
  container.appendChild(saveButton);
}

async function saveInventory(container, product, saveButton) {
  const variantInputs = [...container.querySelectorAll(".variant-stock-input")];
  const stockInput = container.querySelector(".product-stock-input");
  const variants = variantInputs.map((input) => ({
    variantId: input.dataset.variantId,
    stock: Number(input.value || 0),
  }));
  const stock = stockInput
    ? Number(stockInput.value || 0)
    : variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);

  try {
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
    await updateInventory({ productId: product.id, stock, variants });
    showToast("Inventory updated", "success");
    await loadProducts({ renderManager: false, renderControls: true });
  } catch (err) {
    console.error("Failed to update inventory:", err);
    showToast("Failed to update inventory", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save inventory";
  }
}

async function updateProductStatus(product, action) {
  try {
    await updateProduct({
      id: product.id,
      updates: {
        shopStatus: action.status,
        visible: action.visible,
        websiteVisible: action.visible,
        archived: action.archived,
      },
    });
    showToast(`Record status set to ${action.status}`, "success");
    await loadProducts({ renderManager: false, renderControls: true });
  } catch (err) {
    console.error("Failed to update product status:", err);
    showToast("Failed to update product status", "error");
  }
}

async function openProductEditor(product) {
  const entityId = product.connectedEntityId;
  const entityType = String(product.connectedEntityType || "").toLowerCase();
  if (!entityId || !["item", "blueprint", "plan"].includes(entityType)) {
    showToast("Connect this Product to an Item, Blueprint, or Plan before editing it here.", "error");
    return;
  }
  try {
    const { openProductDrawerFromAdmin } = await import("./admin-content-builder.js");
    await openProductDrawerFromAdmin({
      productId: product.id,
      entityType,
      entityId,
    });
  } catch (error) {
    console.error("Failed to open shared Product editor:", error);
    showToast(error.message || "Could not open the Product editor.", "error");
  }
}

function openRequestedProductEdit(products) {
  const params = new URLSearchParams(window.location.search);
  const editId = params.get("edit");
  if (!editId) return;
  const product = products.find((item) => item.id === editId || item.productId === editId);
  if (product) openProductEditor(product);
}

// Retained only for compatibility with cached pre-refactor markup.
// eslint-disable-next-line no-unused-vars
async function handleEditProduct(e) {
  e.preventDefault();
  const id = e.target["edit-id"].value;
  const updates = getFormData("edit");
  try {
    await updateProduct({ id, updates });
    showToast("✅ Product updated", "success");
    e.target.reset();
    e.target.classList.add("hidden");
    loadProducts();
  } catch (err) {
    console.error(err);
    showToast("❌ Failed to update product", "error");
  }
}

function getFormData(prefix) {
  const name = document.getElementById(`${prefix}-name`)?.value.trim();
  const priceValue = parseFloat(document.getElementById(`${prefix}-price`)?.value);
  const stockValue = parseInt(document.getElementById(`${prefix}-stock`)?.value, 10);
  const price = Number.isFinite(priceValue) ? priceValue : 0;
  const productType = document.getElementById(`${prefix}-type`)?.value || "Physical";
  const status = document.getElementById(`${prefix}-status`)?.value || "draft";
  const visible = document.getElementById(`${prefix}-visible`)?.checked === true;
  const stock = Number.isFinite(stockValue) ? stockValue : 0;
  const tagsValue = document.getElementById(`${prefix}-tags`)?.value || "";
  const tags = tagsValue.split(",").map((t) => t.trim()).filter(Boolean);
  const description = document.getElementById(`${prefix}-description`)?.value || "";
  return {
    name,
    price,
    priceFrom: price,
    productType,
    type: productType,
    stock,
    tags,
    shortDescription: description,
    longDescription: description,
    description,
    visible,
    websiteVisible: visible,
    status,
    shopStatus: status,
    requiresShipping: document.getElementById(`${prefix}-shipping`)?.checked === true,
    inventoryTracked: document.getElementById(`${prefix}-inventory`)?.checked === true,
  };
}

function parseAssetRenditions(value = "") {
  return String(value).split(/\r?\n/).map((line, index) => {
    const [renditionName, purpose, fileUrl, width, height, defaultValue, status] =
      line.split("|").map((part) => part.trim());
    if (!renditionName || !fileUrl) return null;
    return {
      renditionName,
      purpose,
      fileUrl,
      width: Number(width || 0) || null,
      height: Number(height || 0) || null,
      isDefault: ["yes", "true", "1"].includes(String(defaultValue).toLowerCase()),
      status: status || "active",
      sortOrder: index + 1,
    };
  }).filter(Boolean);
}

function serializeAssetRenditions(values = []) {
  return values.map((rendition) => [
    rendition.renditionName || rendition.name || "",
    rendition.purpose || "",
    rendition.fileUrl || rendition.url || "",
    rendition.width || "",
    rendition.height || "",
    rendition.isDefault ? "yes" : "no",
    rendition.status || "active",
  ].join(" | ")).join("\n");
}

function resetAssetForm() {
  const form = document.getElementById("assetManagerForm");
  form?.reset();
  form?.classList.add("hidden");
  document.getElementById("assetManagerId").value = "";
  document.getElementById("assetManagerFileUrl").value = "";
  document.getElementById("assetManagerRenditions").value = "";
  document.getElementById("assetManagerLinks").textContent = "No linked entities.";
  document.getElementById("assetLinkEntityType").value = "";
  document.getElementById("assetLinkEntityId").value = "";
  document.getElementById("assetLinkRole").value = "";
}

function renderAssetLinks(links = []) {
  const container = document.getElementById("assetManagerLinks");
  if (!container) return;
  if (!links.length) {
    container.textContent = "No linked entities.";
    return;
  }
  container.innerHTML = links.map((link) => `
    <label class="flex items-start gap-2 rounded border border-gray-700 p-2">
      <input class="asset-unlink-checkbox mt-1" type="checkbox" value="${escapeHTML(link.id)}">
      <span>
        <strong>${escapeHTML(link.entityType)} ${escapeHTML(link.entityId)}</strong>
        <span class="block text-xs text-gray-400">
          ${escapeHTML(link.assetRole || "Related")} | ${escapeHTML(link.fieldKey || "No field key")}
        </span>
        <span class="block text-xs text-red-300">Select to unlink when saving</span>
      </span>
    </label>
  `).join("");
}

function openAssetForm(asset = null) {
  const form = document.getElementById("assetManagerForm");
  if (!form) return;
  form.classList.remove("hidden");
  document.getElementById("assetManagerId").value = asset?.id || asset?.assetId || "";
  document.getElementById("assetManagerName").value = asset?.assetName || asset?.name || "";
  document.getElementById("assetManagerType").value = asset?.assetType || "Document";
  document.getElementById("assetManagerStatus").value = asset?.status || "draft";
  document.getElementById("assetManagerVisibility").value = asset?.visibility || "private";
  document.getElementById("assetManagerTitle").value = asset?.title || "";
  document.getElementById("assetManagerDescription").value = asset?.description || "";
  document.getElementById("assetManagerAltText").value = asset?.altText || "";
  document.getElementById("assetManagerFileUrl").value = asset?.fileUrl || asset?.url || "";
  document.getElementById("assetManagerRenditions").value = serializeAssetRenditions(asset?.renditions || []);
  renderAssetLinks(asset?.links || []);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function uploadAssetManagerFile(assetId) {
  const file = document.getElementById("assetManagerFile")?.files?.[0];
  if (!file) return document.getElementById("assetManagerFileUrl")?.value || "";
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const storageRef = ref(storage, `assets/${assetId || Date.now()}/${Date.now()}-${safeName}`);
  await uploadBytes(storageRef, file, { contentType: file.type || undefined });
  return getDownloadURL(storageRef);
}

async function saveAsset(event) {
  event.preventDefault();
  const assetId = document.getElementById("assetManagerId")?.value || "";
  const assetName = document.getElementById("assetManagerName")?.value.trim() || "";
  if (!assetName) return;
  try {
    const fileUrl = await uploadAssetManagerFile(assetId || assetName);
    if (!fileUrl) throw new Error("Choose a file for this Asset.");
    await upsertAdminAsset({
      assetId,
      assetName,
      assetType: document.getElementById("assetManagerType")?.value || "Document",
      status: document.getElementById("assetManagerStatus")?.value || "draft",
      visibility: document.getElementById("assetManagerVisibility")?.value || "private",
      title: document.getElementById("assetManagerTitle")?.value || assetName,
      description: document.getElementById("assetManagerDescription")?.value || "",
      altText: document.getElementById("assetManagerAltText")?.value || "",
      fileUrl,
      renditions: parseAssetRenditions(document.getElementById("assetManagerRenditions")?.value),
      replaceRenditions: true,
      unlinkEntityAssetIds: [...document.querySelectorAll(".asset-unlink-checkbox:checked")]
        .map((input) => input.value),
      newLinks: document.getElementById("assetLinkEntityType")?.value &&
          document.getElementById("assetLinkEntityId")?.value
        ? [{
          entityType: document.getElementById("assetLinkEntityType").value,
          entityId: document.getElementById("assetLinkEntityId").value.trim(),
          assetRole: document.getElementById("assetLinkRole")?.value.trim() || "Related",
        }]
        : [],
    });
    showToast("Asset saved", "success");
    resetAssetForm();
    await loadAssets();
  } catch (error) {
    console.error("Failed to save Asset:", error);
    showToast(error.message || "Failed to save Asset", "error");
  }
}

function renderAssets() {
  const list = document.getElementById("assetManagerList");
  if (!list) return;
  if (!cachedAssets.length) {
    list.textContent = "No reusable Assets found.";
    return;
  }
  list.innerHTML = cachedAssets
    .sort((left, right) => String(left.assetName || left.name).localeCompare(right.assetName || right.name))
    .map((asset) => `
      <article class="rounded border border-gray-700 bg-gray-900/50 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold text-white">
              ${escapeHTML(asset.assetName || asset.name || asset.id)}
            </h3>
            <p class="text-xs text-gray-400">
              ${escapeHTML(asset.id)} | ${escapeHTML(asset.assetType || asset.type)}
            </p>
            <p class="mt-1 text-xs text-gray-400">
              ${(asset.renditions || []).length} rendition(s) | ${escapeHTML(asset.status || "draft")}
            </p>
          </div>
          <button
            type="button"
            class="edit-asset rounded border border-gray-600 px-3 py-2 text-sm"
            data-asset-id="${escapeHTML(asset.id)}"
          >Edit</button>
        </div>
      </article>
    `).join("");
  list.querySelectorAll(".edit-asset").forEach((button) => {
    button.addEventListener("click", () => {
      openAssetForm(cachedAssets.find((asset) => asset.id === button.dataset.assetId));
    });
  });
}

async function loadAssets() {
  const list = document.getElementById("assetManagerList");
  if (list) list.textContent = "Loading Assets...";
  try {
    const response = await getAdminAssets();
    cachedAssets = response.data?.assets || [];
    renderAssets();
  } catch (error) {
    console.error("Failed to load Assets:", error);
    if (list) list.textContent = "Assets could not be loaded.";
  }
}

function setupAssetManager() {
  const form = document.getElementById("assetManagerForm");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  form.addEventListener("submit", saveAsset);
  document.getElementById("newAssetBtn")?.addEventListener("click", () => openAssetForm());
  document.getElementById("cancelAssetBtn")?.addEventListener("click", resetAssetForm);
  loadAssets();
}
