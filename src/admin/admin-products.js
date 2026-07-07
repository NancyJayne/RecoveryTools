import { httpsCallable } from "firebase/functions";
import { functions } from "../utils/firebase-config.js";
import { showToast } from "../utils/utils.js";
import { attachDeleteHandlers } from "./admin-delete.js";

const createProduct = httpsCallable(functions, "createProduct");
const updateProduct = httpsCallable(functions, "updateProduct");
const getProducts = httpsCallable(functions, "getFirestoreProducts");

function asMoney(value) {
  const amount = Number(value ?? 0);
  return `$${amount.toFixed(2)}`;
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

export function setupProductManager() {
  const form = document.getElementById("addProductForm");
  const list = document.getElementById("productList");

  if (form && list) {
    form.addEventListener("submit", handleCreateProduct);
    loadProducts();
  }

  const editForm = document.getElementById("editProductForm");
  if (editForm) {
    editForm.addEventListener("submit", handleEditProduct);
  }
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

async function loadProducts() {
  const container = document.getElementById("productList");
  if (!container) return;

  container.textContent = "Loading products...";
  const res = await getProducts({ includeHidden: true });
  const products = Array.isArray(res.data?.products) ? res.data.products : [];

  container.textContent = "";

  products.forEach((p) => {
    const div = document.createElement("div");
    div.className = "bg-gray-800 p-4 rounded shadow flex gap-4 items-start";

    const imageUrl = getProductImage(p);
    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = p.name || p.title || "Product image";
      img.className = "w-20 h-20 object-cover rounded bg-gray-900";
      div.appendChild(img);
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

    btn.addEventListener("click", () => {
      const product = JSON.parse(btn.dataset.product);
      populateEditForm(product);
    });

    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(tags);
    body.appendChild(description);
    body.appendChild(btn);
    div.appendChild(body);
    container.appendChild(div);
  });

  attachDeleteHandlers("productList", "product");
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
