import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";
import { showTabContent, showToast } from "../utils/utils.js";
import { attachDeleteHandlers } from "./admin-delete.js";

const createProduct = httpsCallable(functions, "createProduct");
const updateProduct = httpsCallable(functions, "updateProduct");
const updateInventory = httpsCallable(functions, "updateProductInventory");
const getProducts = httpsCallable(functions, "getFirestoreProducts");

let cachedProducts = [];

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
  const form = document.getElementById("addProductForm");
  const list = document.getElementById("productList");

  if (form && form.dataset.bound !== "true") {
    form.dataset.bound = "true";
    form.addEventListener("submit", handleCreateProduct);
  }

  if (list) {
    loadProducts();
  }

  const editForm = document.getElementById("editProductForm");
  if (editForm && editForm.dataset.bound !== "true") {
    editForm.dataset.bound = "true";
    editForm.addEventListener("submit", handleEditProduct);
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

async function handleCreateProduct(e) {
  e.preventDefault();
  const data = getFormData("add");
  try {
    await createProduct(data);
    showToast("✅ Product created", "success");
    e.target.reset();
    loadProducts();
  } catch (err) {
    console.error(err);
    showToast("❌ Failed to create product", "error");
  }
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
    div.className = "rounded border border-gray-700 bg-gray-800 p-4 shadow";

    const row = document.createElement("div");
    row.className = "flex flex-col gap-4 md:flex-row md:items-start";

    const imageUrl = getProductImage(p);
    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = p.name || p.title || "Product image";
      img.className = "w-20 h-20 object-cover rounded bg-gray-900";
      row.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "flex-1";

    const title = document.createElement("h3");
    title.className = "text-lg font-bold mb-1";
    title.textContent = p.name || p.title || p.id;

    const meta = document.createElement("p");
    meta.className = "text-sm";
    meta.textContent = [
      asMoney(p.price ?? p.priceFrom),
      p.type || "unknown",
      `Stock: ${p.stock ?? 0}`,
      `Status: ${p.shopStatus || (p.visible ? "active" : "hidden")}`,
      p.visible ? "Visible" : "Hidden",
    ].join(" | ");

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

    row.appendChild(body);
    div.appendChild(row);
    container.appendChild(div);
  });

  attachDeleteHandlers("productList", "product");
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

function openProductEditor(product) {
  const container = document.getElementById("adminSection");
  container?.querySelectorAll(".admin-tab, .admin-section").forEach((el) => {
    el.classList.add("hidden");
  });
  document.getElementById("productManagerPanel")?.classList.remove("hidden");
  showTabContent("adminSection");
  history.pushState({}, "", `/admin/products?edit=${encodeURIComponent(product.id)}`);
  setupProductManager();
  populateEditForm(product);
  document.getElementById("editProductForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openRequestedProductEdit(products) {
  const params = new URLSearchParams(window.location.search);
  const editId = params.get("edit");
  if (!editId) return;
  const product = products.find((item) => item.id === editId || item.productId === editId);
  if (product) populateEditForm(product);
}

function populateEditForm(product) {
  const form = document.getElementById("editProductForm");
  if (!form) return;
  form.classList.remove("hidden");
  form["edit-id"].value = product.id;
  form["edit-name"].value = product.name || product.title || "";
  form["edit-price"].value = product.price ?? product.priceFrom ?? 0;
  form["edit-type"].value = product.type || "tool";
  form["edit-stock"].value = product.stock ?? 0;
  form["edit-tags"].value = productTags(product).join(", ");
  form["edit-description"].value =
    product.shortDescription ||
    product.description ||
    product.longDescription ||
    "";
}

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
  const type = document.getElementById(`${prefix}-type`)?.value?.toLowerCase() || "tool";
  const stock = Number.isFinite(stockValue) ? stockValue : 0;
  const tagsValue = document.getElementById(`${prefix}-tags`)?.value || "";
  const tags = tagsValue.split(",").map((t) => t.trim()).filter(Boolean);
  const description = document.getElementById(`${prefix}-description`)?.value || "";
  return {
    name,
    price,
    priceFrom: price,
    type,
    stock,
    tags,
    shortDescription: description,
    longDescription: description,
    description,
    visible: true,
    websiteVisible: true,
    shopStatus: "active",
  };
}
