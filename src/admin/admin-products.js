import { httpsCallable } from "firebase/functions";
import { functions, db } from "../utils/firebase-config.js";
import { collection, getDocs } from "firebase/firestore";
import { showToast } from "../utils/utils.js";
import { attachDeleteHandlers } from "./admin-delete.js";

const createProduct = httpsCallable(functions, "createProduct");
const updateProduct = httpsCallable(functions, "updateProduct");

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
  const snapshot = await getDocs(collection(db, "products"));
  const products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  container.textContent = "";

  products.forEach((p) => {
    const div = document.createElement("div");
    div.className = "bg-gray-800 p-4 rounded shadow";

    const title = document.createElement("h3");
    title.className = "text-lg font-bold mb-1";
    title.textContent = p.name;

    const meta = document.createElement("p");
    meta.className = "text-sm";
    meta.textContent = `$${p.price} | ${p.type} | Stock: ${p.stock}`;

    const tags = document.createElement("p");
    tags.className = "text-sm text-gray-400";
    tags.textContent = `Tags: ${p.tags?.join(", ") || "None"}`;

    const btn = document.createElement("button");
    btn.className = "edit-btn mt-2 px-3 py-1 rounded bg-blue-600 text-white";
    btn.textContent = "Edit";
    btn.dataset.product = JSON.stringify(p);

    btn.addEventListener("click", () => {
      const product = JSON.parse(btn.dataset.product);
      populateEditForm(product);
    });

    div.appendChild(title);
    div.appendChild(meta);
    div.appendChild(tags);
    div.appendChild(btn);
    container.appendChild(div);
  });

  attachDeleteHandlers("productList", "product");
}

function populateEditForm(product) {
  const form = document.getElementById("editProductForm");
  if (!form) return;
  form.classList.remove("hidden");
  form["edit-id"].value = product.id;
  form["edit-name"].value = product.name;
  form["edit-price"].value = product.price;
  form["edit-type"].value = product.type;
  form["edit-stock"].value = product.stock;
  form["edit-tags"].value = product.tags?.join(", ") || "";
  form["edit-description"].value = product.description || "";
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
  const price = parseFloat(document.getElementById(`${prefix}-price`)?.value);
  const type = document.getElementById(`${prefix}-type`)?.value;
  const stock = parseInt(document.getElementById(`${prefix}-stock`)?.value);
  const tagsValue = document.getElementById(`${prefix}-tags`)?.value || "";
  const tags = tagsValue.split(",").map((t) => t.trim()).filter(Boolean);
  const description = document.getElementById(`${prefix}-description`)?.value || "";
  return { name, price, type, stock, tags, description };
}
