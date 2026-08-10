// admin-crm.js – Unified User CRM Panel with Role Assignment, Password Reset, and Links
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../utils/firebase-config.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { showToast } from "../utils/utils.js";

const CRM_FORM_ID = "roleForm";
const SEARCH_INPUT_ID = "userSearchInput";
const SEARCH_RESULTS_ID = "userSearchResults";
const SELECTED_USER_PANEL_ID = "selectedUserPanel";
const USER_SELECT_ID = "userSelect";
let crmUsers = [];
let selectedUserId = "";
let creatingCrmUser = false;
const accessCatalog = { Course: [], Workshop: [], Program: [] };
let accessProducts = [];
let allProducts = [];

function formatDateValue(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}
const crmRelationships = {
  purchasers: new Set(),
  products: new Map(),
  courses: new Map(),
  workshops: new Map(),
  programs: new Map(),
};

function addRelationship(map, id, uid) {
  if (!id || !uid) return;
  if (!map.has(id)) map.set(id, new Set());
  map.get(id).add(uid);
}

function orderOwner(order = {}) {
  return order.userId || order.buyerUid || order.uid || order.firebaseUserId || "";
}

function orderLines(order = {}) {
  return order.items || order.orderItems || order.lineItems || order.products || [];
}

function isArchivedUser(user = {}) {
  return user.archived === true || ["archived", "merged"].includes(String(user.status || "").toLowerCase()) ||
    user.active === false;
}

function currentFilteredUsers() {
  const term = document.getElementById(SEARCH_INPUT_ID)?.value.trim().toLowerCase() || "";
  const status = document.getElementById("crmStatusFilter")?.value || "active";
  const role = document.getElementById("crmRoleFilter")?.value || "all";
  const engagement = document.getElementById("crmEngagementFilter")?.value || "all";
  const contentId = document.getElementById("crmContentFilter")?.value || "";
  const relationshipMap = {
    product: crmRelationships.products,
    course: crmRelationships.courses,
    workshop: crmRelationships.workshops,
    program: crmRelationships.programs,
  }[engagement];
  return crmUsers.filter((user) => {
    const archived = isArchivedUser(user);
    if (status === "active" && archived) return false;
    if (status === "archived" && !archived) return false;
    if (term && !searchableText(user).includes(term)) return false;
    if (role === "customer" && ["admin", "affiliate", "therapist"].some((entry) => roleEnabled(user, entry))) {
      return false;
    }
    if (role !== "all" && role !== "customer" && !roleEnabled(user, role)) return false;
    if (engagement === "purchase" && !crmRelationships.purchasers.has(user.id)) return false;
    if (relationshipMap && contentId && !relationshipMap.get(contentId)?.has(user.id)) return false;
    if (relationshipMap && !contentId) {
      const hasAny = [...relationshipMap.values()].some((uids) => uids.has(user.id));
      if (!hasAny) return false;
    }
    return true;
  });
}

function applyCrmUserFilters() {
  const users = currentFilteredUsers();
  renderSearchResults(users);
  const count = document.getElementById("crmUserResultCount");
  if (count) count.textContent = `${users.length} of ${crmUsers.length} users shown`;
}

function selectedProductIds() {
  return [...document.querySelectorAll(".crm-product-select")]
    .map((select) => select.value)
    .filter(Boolean);
}

function selectedProductRows() {
  return [...document.querySelectorAll("#crmProductRows > div")].map((row) => ({
    productId: row.querySelector(".crm-product-select")?.value || "",
    quantity: Math.max(1, Number(row.querySelector(".crm-product-quantity")?.value || 1)),
  })).filter((row) => row.productId);
}

function refreshProductRowOptions() {
  const selected = new Set(selectedProductIds());
  document.querySelectorAll(".crm-product-select").forEach((select) => {
    const current = select.value;
    select.innerHTML = [
      "<option value=''>Choose a Product...</option>",
      ...accessProducts
        .filter((product) => !selected.has(product.id) || product.id === current)
        .map((product) => (
          `<option value="${escapeHTML(product.id)}">${escapeHTML(product.name)}</option>`
        )),
    ].join("");
    select.value = current;
  });
}

function addProductRow(value = "") {
  const container = document.getElementById("crmProductRows");
  if (!container) return;
  container.querySelector("[data-loading-products]")?.remove();
  const row = document.createElement("div");
  row.className = "flex gap-2";
  row.innerHTML = `
    <select class="crm-product-select input min-w-0 flex-1" aria-label="Access Product"></select>
    <label class="flex w-24 items-center gap-2 text-sm text-gray-300">
      <span>Qty</span>
      <input type="number" min="1" step="1" value="1" class="crm-product-quantity input min-w-0 w-full"
        aria-label="Quantity">
    </label>
    <button type="button" class="rounded bg-gray-700 px-3 py-2 hover:bg-gray-600"
      aria-label="Remove Product">Remove</button>
  `;
  container.appendChild(row);
  const select = row.querySelector("select");
  select.addEventListener("change", refreshProductRowOptions);
  row.querySelector("button").addEventListener("click", () => {
    row.remove();
    if (!container.querySelector(".crm-product-select")) addProductRow();
    refreshProductRowOptions();
  });
  refreshProductRowOptions();
  select.value = value;
}

function showProductAction(action) {
  const manual = action === "manual";
  document.getElementById("manualUnlockPanel")?.classList.toggle("hidden", !manual);
  document.getElementById("sendCartPanel")?.classList.toggle("hidden", manual);
  [
    ["showManualUnlockBtn", manual],
    ["showSendCartBtn", !manual],
  ].forEach(([id, active]) => {
    const button = document.getElementById(id);
    button?.setAttribute("aria-selected", String(active));
    button?.classList.toggle("bg-[#407471]", active);
    button?.classList.toggle("bg-gray-700", !active);
  });
}

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function displayName(user = {}) {
  return user.name || user.displayName || user.fullName || user.email || user.id;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(Number(value || 0));
}

function searchableText(user = {}) {
  return [
    user.id,
    user.uid,
    user.name,
    user.displayName,
    user.fullName,
    user.email,
    user.phone,
    user.phoneNumber,
  ].filter(Boolean).join(" ").toLowerCase();
}

function roleEnabled(user = {}, role) {
  if (user.roles?.[role] === true || user[role] === true) return true;
  if (Array.isArray(user.roles)) return user.roles.includes(role);
  return String(user.role || "").toLowerCase() === role;
}

function renderSearchResults(users = []) {
  const resultsContainer = document.getElementById(SEARCH_RESULTS_ID);
  if (!resultsContainer) return;
  resultsContainer.innerHTML = users.length
    ? users.map((user) => `
      <li class="flex items-center gap-3 rounded border border-gray-700 px-3 py-2 hover:border-purple-500">
        <input type="checkbox" class="crm-user-check" value="${escapeHTML(user.id)}"
          aria-label="Select ${escapeHTML(displayName(user))}">
        <label class="flex items-center gap-1 text-xs text-gray-400" title="Keep this profile when merging">
          <input type="radio" name="crmPrimaryUser" value="${escapeHTML(user.id)}"> Primary
        </label>
        <button type="button" data-uid="${escapeHTML(user.id)}" class="min-w-0 flex-1 text-left">
          <span class="font-medium text-white">${escapeHTML(displayName(user))}</span>
          <span class="ml-2 text-sm text-gray-400">${escapeHTML(user.email || user.id)}</span>
          ${user.archived ? "<span class='ml-2 text-xs text-gray-500'>Archived</span>" : ""}
        </button>
      </li>
    `).join("")
    : "<li class='text-sm text-gray-400'>No users match this search.</li>";

  resultsContainer.querySelectorAll("button[data-uid]").forEach((button) => {
    button.addEventListener("click", () => selectUser(button.dataset.uid));
  });
  resultsContainer.querySelectorAll("input[name='crmPrimaryUser']").forEach((radio) => {
    radio.addEventListener("change", () => {
      const checkbox = resultsContainer.querySelector(`.crm-user-check[value="${CSS.escape(radio.value)}"]`);
      if (checkbox) checkbox.checked = true;
    });
  });
}

function updateCrmContentFilter() {
  const engagement = document.getElementById("crmEngagementFilter")?.value || "all";
  const select = document.getElementById("crmContentFilter");
  if (!select) return;
  const catalog = {
    product: allProducts,
    course: accessCatalog.Course,
    workshop: accessCatalog.Workshop,
    program: accessCatalog.Program,
  }[engagement] || [];
  select.disabled = !catalog.length;
  select.innerHTML = catalog.length
    ? ["<option value=''>All matching content</option>", ...catalog.map((entry) => (
      `<option value="${escapeHTML(entry.id)}">${escapeHTML(entry.name)}</option>`
    ))].join("")
    : `<option value="">${engagement === "purchase" ? "Any purchase" : "Choose an activity first"}</option>`;
}

async function loadCrmRelationships() {
  const [ordersSnapshot, accessSnapshot] = await Promise.all([
    getDocs(collection(db, "orders")),
    getDocs(collection(db, "userAccess")),
  ]);
  crmRelationships.purchasers.clear();
  ["products", "courses", "workshops", "programs"].forEach((key) => crmRelationships[key].clear());
  ordersSnapshot.docs.forEach((orderDoc) => {
    const order = orderDoc.data();
    const uid = orderOwner(order);
    if (!uid) return;
    crmRelationships.purchasers.add(uid);
    orderLines(order).forEach((line) => {
      addRelationship(
        crmRelationships.products,
        line.productId || line.ProductID || line.id || line.itemId,
        uid,
      );
    });
  });
  accessSnapshot.docs.forEach((accessDoc) => {
    const access = accessDoc.data();
    const type = String(access.accessType || access.accessEntityType || "").toLowerCase();
    const accessId = access.accessId || access.accessEntityId;
    const catalogType = Object.entries(accessCatalog).find(([, entries]) => (
      entries.some((entry) => entry.id === accessId)
    ))?.[0]?.toLowerCase();
    const map = crmRelationships[`${catalogType || type}s`];
    if (map) addRelationship(map, accessId, access.userId || access.uid);
  });
  applyCrmUserFilters();
}

function checkedCrmUserIds() {
  return [...document.querySelectorAll(".crm-user-check:checked")].map((input) => input.value);
}

function addressFieldsHtml(prefix) {
  const fields = [
    ["Line 1", "line1"], ["Line 2", "line2"], ["Suburb/city", "city"],
    ["State", "state"], ["Postcode", "postcode"], ["Country", "country"],
  ];
  return fields.map(([label, key]) => (
    `<label class="text-sm">${label}<input id="${prefix}${key}" class="input mt-1 w-full"></label>`
  )).join("");
}

function normalizedAddress(user, type) {
  const value = user[`${type}Address`] || user[`default${type[0].toUpperCase()}${type.slice(1)}Address`] || {};
  if (typeof value === "string") return { line1: value };
  return value;
}

function fillAddress(prefix, value = {}) {
  ["line1", "line2", "city", "state", "postcode", "country"].forEach((key) => {
    const input = document.getElementById(`${prefix}${key}`);
    if (input) input.value = value[key] || (key === "postcode" ? value.postal_code : "") || "";
  });
}

function readAddress(prefix) {
  return Object.fromEntries(["line1", "line2", "city", "state", "postcode", "country"].map((key) => (
    [key, document.getElementById(`${prefix}${key}`)?.value.trim() || ""]
  )));
}

async function manageProfiles(payload) {
  const callable = httpsCallable(functions, "manageUserProfiles");
  return callable(payload);
}

async function saveCrmProfile() {
  if (!selectedUserId && !creatingCrmUser) return showToast("Select a user first.", "error");
  const profile = {
    name: document.getElementById("crmProfileName")?.value.trim(),
    email: document.getElementById("crmProfileEmail")?.value.trim(),
    phone: document.getElementById("crmProfilePhone")?.value.trim(),
    shippingAddress: readAddress("crmShipping"),
    billingAddress: readAddress("crmBilling"),
    businessName: document.getElementById("crmBusinessName")?.value.trim(),
    businessAbn: document.getElementById("crmBusinessAbn")?.value.trim(),
    businessWebsite: document.getElementById("crmBusinessWebsite")?.value.trim(),
    businessEmail: document.getElementById("crmBusinessEmail")?.value.trim(),
    businessPhone: document.getElementById("crmBusinessPhone")?.value.trim(),
    businessAddress: document.getElementById("crmBusinessAddress")?.value.trim(),
    affiliatePickup: {
      enabled: document.getElementById("crmAffiliatePickupEnabled")?.checked === true,
      approvalStatus: document.getElementById("crmAffiliatePickupApproval")?.value || "draft",
      locationName: document.getElementById("crmAffiliatePickupName")?.value.trim(),
      addressLine1: document.getElementById("crmAffiliatePickupLine1")?.value.trim(),
      addressLine2: document.getElementById("crmAffiliatePickupLine2")?.value.trim(),
      suburb: document.getElementById("crmAffiliatePickupSuburb")?.value.trim(),
      state: document.getElementById("crmAffiliatePickupState")?.value.trim(),
      postcode: document.getElementById("crmAffiliatePickupPostcode")?.value.trim(),
      country: document.getElementById("crmAffiliatePickupCountry")?.value.trim() || "Australia",
    },
  };
  if (!profile.name || !profile.email) return showToast("Name and email are required.", "error");
  if (creatingCrmUser) {
    const password = document.getElementById("crmCreatePassword")?.value || "";
    if (password.length < 8) return showToast("Enter a temporary password of at least 8 characters.", "error");
    profile.active = true;
    profile.roles = {
      admin: document.getElementById("roleAdmin").checked,
      affiliate: document.getElementById("roleAffiliate").checked,
      therapist: document.getElementById("roleTherapist").checked,
    };
    const createUser = httpsCallable(functions, "adminCreateUser");
    const result = await createUser({
      email: profile.email,
      password,
      displayName: profile.name,
      roles: profile.roles,
    });
    selectedUserId = result.data.uid;
    await manageProfiles({ action: "update", uid: selectedUserId, profile });
    creatingCrmUser = false;
    showToast("Active user account created", "success");
  } else {
    await manageProfiles({ action: "update", uid: selectedUserId, profile });
    showToast("Profile saved", "success");
  }
  await loadUsers();
  await selectUser(selectedUserId);
}

async function approveCrmAffiliatePickup() {
  if (!selectedUserId) return showToast("Select an affiliate first.", "error");
  const enabled = document.getElementById("crmAffiliatePickupEnabled");
  const approval = document.getElementById("crmAffiliatePickupApproval");
  if (enabled) enabled.checked = true;
  if (approval) approval.value = "approved";
  await saveCrmProfile();
  showToast("Pickup address approved", "success");
}

function startCreateCrmUser() {
  creatingCrmUser = true;
  selectedUserId = "";
  document.getElementById(SELECTED_USER_PANEL_ID)?.classList.remove("hidden");
  document.getElementById("crmNoUserSelected")?.classList.add("hidden");
  document.getElementById("selectedUserName").textContent = "New active user";
  document.getElementById("selectedUserMeta").textContent = "Complete the profile and choose roles before saving.";
  document.getElementById("roleUid").value = "";
  ["roleAdmin", "roleAffiliate", "roleTherapist"].forEach((id) => {
    document.getElementById(id).checked = false;
  });
  [
    "crmProfileName", "crmProfileEmail", "crmProfilePhone", "crmBusinessName", "crmBusinessAbn",
    "crmBusinessWebsite", "crmBusinessEmail", "crmBusinessPhone", "crmBusinessAddress", "crmCreatePassword",
  ].forEach((id) => { const input = document.getElementById(id); if (input) input.value = ""; });
  fillAddress("crmShipping", { country: "AU" });
  fillAddress("crmBilling", { country: "AU" });
  document.getElementById("crmBusinessFields")?.classList.remove("hidden");
  document.getElementById("crmAccountSecurity")?.classList.add("hidden");
  document.getElementById("crmCreatePasswordRow")?.classList.remove("hidden");
  document.getElementById("saveCrmProfileBtn").textContent = "Create active user";
  document.getElementById("crmProfileName")?.focus();
}

async function archiveSelectedUsers() {
  const uids = checkedCrmUserIds();
  if (!uids.length) return showToast("Select at least one profile to archive.", "error");
  if (!window.confirm(`Archive and disable ${uids.length} selected account${uids.length === 1 ? "" : "s"}?`)) return;
  await manageProfiles({ action: "archive", uids });
  showToast(`${uids.length} profile${uids.length === 1 ? "" : "s"} archived`, "success");
  selectedUserId = "";
  document.getElementById(SELECTED_USER_PANEL_ID)?.classList.add("hidden");
  await loadUsers();
}

async function mergeSelectedUsers() {
  const uids = checkedCrmUserIds();
  const primaryUid = document.querySelector("input[name='crmPrimaryUser']:checked")?.value || "";
  if (uids.length < 2 || !primaryUid || !uids.includes(primaryUid)) {
    return showToast("Select at least two profiles and mark one selected profile as Primary.", "error");
  }
  const sources = uids.filter((uid) => uid !== primaryUid);
  const noun = `duplicate profile${sources.length === 1 ? "" : "s"}`;
  if (!window.confirm(
    `Merge ${sources.length} ${noun} into the Primary profile? Duplicate sign-ins will be disabled.`,
  )) return;
  await manageProfiles({ action: "merge", primaryUid, uids: sources });
  showToast("Profiles merged. Duplicate accounts were archived and disabled.", "success");
  await loadUsers();
  await selectUser(primaryUid);
}

async function loadUsers() {
  const select = document.getElementById(USER_SELECT_ID);
  try {
    const [snapshot, affiliateSnapshot, therapistSnapshot] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "affiliates")),
      getDocs(collection(db, "therapists")),
    ]);
    const affiliateUids = new Set(affiliateSnapshot.docs.map((record) => record.id));
    const therapistUids = new Set(therapistSnapshot.docs.map((record) => record.id));
    crmUsers = snapshot.docs
      .map((userDoc) => {
        const user = userDoc.data();
        return {
          id: userDoc.id,
          ...user,
          roles: {
            ...(user.roles || {}),
            affiliate: roleEnabled(user, "affiliate") || affiliateUids.has(userDoc.id),
            therapist: roleEnabled(user, "therapist") || therapistUids.has(userDoc.id),
          },
        };
      })
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));

    if (select) {
      select.innerHTML = [
        `<option value="">Select from ${crmUsers.length} users...</option>`,
        ...crmUsers.map((user) => {
          const label = `${displayName(user)} - ${user.email || user.id}`;
          return `<option value="${escapeHTML(user.id)}">${escapeHTML(label)}</option>`;
        }),
      ].join("");
    }
    applyCrmUserFilters();
  } catch (err) {
    console.error("Failed to load CRM users:", err);
    if (select) select.innerHTML = "<option value=''>Unable to load users</option>";
    showToast("Unable to load CRM users", "error");
  }
}

async function loadAccessCatalog() {
  const rows = document.getElementById("crmProductRows");
  if (rows) rows.innerHTML = "<p data-loading-products class='text-sm text-gray-400'>Loading Products...</p>";
  Object.values(accessCatalog).forEach((entries) => entries.splice(0));
  await Promise.allSettled(["items", "blueprints", "plans"].map(async (collectionName) => {
    const snapshot = await getDocs(collection(db, collectionName));
    snapshot.docs.forEach((record) => {
      const content = record.data();
      const contentType = String(
        content.type || content.itemType || content.blueprintType ||
        content.planType || content.planTypeName || "",
      ).trim().toLowerCase();
      const catalogType = {
        course: "Course",
        workshop: "Workshop",
        program: "Program",
      }[contentType];
      if (!catalogType || accessCatalog[catalogType].some((entry) => entry.id === record.id)) return;
      accessCatalog[catalogType].push({
        id: record.id,
        name: content.name || content.title || record.id,
      });
    });
  }));
  Object.values(accessCatalog).forEach((entries) => {
    entries.sort((a, b) => a.name.localeCompare(b.name));
  });
  try {
    const [productsSnap, grantsSnap, pricesSnap] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(collection(db, "productAccessGrants")),
      getDocs(collection(db, "productPrices")),
    ]);
    const grants = grantsSnap.docs.map((grantDoc) => ({ id: grantDoc.id, ...grantDoc.data() }));
    const prices = new Map(pricesSnap.docs.map((priceDoc) => {
      const price = priceDoc.data();
      return [price.productId || price.ProductID, price.effectiveShopPrice || price.EffectiveShopPrice];
    }));
    allProducts = productsSnap.docs.map((productDoc) => {
      const product = productDoc.data();
      const productGrants = grants.filter((grant) => (
        (grant.productId || grant.ProductID) === productDoc.id
      ));
      return {
        id: productDoc.id,
        name: product.name || product.productName || product.title || productDoc.id,
        price: Number(prices.get(productDoc.id) || product.effectivePrice || product.price || 0),
        type: product.type || product.productType || "course",
        requiresShipping: product.requiresShipping === true,
        image: product.image || product.imageUrl || "/images/product-placeholder.png",
        unlocksAccess: product.unlocksAccess === true || productGrants.length > 0,
        accessGrants: productGrants,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    accessProducts = allProducts.filter((product) => product.unlocksAccess);
    updateCrmContentFilter();
    if (rows) rows.innerHTML = "";
    addProductRow();
  } catch (err) {
    console.error("Failed to load CRM access Products:", err);
    if (rows) rows.innerHTML = "<p class='text-sm text-red-300'>Unable to load access Products.</p>";
    showToast("Unable to load access Products", "error");
  }
}

function sharedCartItem(product, quantity = 1) {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    quantity,
    type: product.type,
    requiresShipping: product.requiresShipping,
    image: product.image,
  };
}

async function createSharedCart({ email = false } = {}) {
  const productRows = selectedProductRows();
  const productIds = productRows.map((row) => row.productId);
  const recipientEmail = document.getElementById("crmCartRecipientEmail")?.value.trim();
  const message = document.getElementById("crmCartMessage")?.value.trim();
  const products = accessProducts.filter((entry) => productIds.includes(entry.id));
  if (!selectedUserId || !products.length) return showToast("Select at least one access Product.", "error");
  if (email && !recipientEmail) return showToast("Enter the recipient email.", "error");

  const sharedCartId = crypto.randomUUID();
  const link = `${window.location.origin}/cart?sharedCart=${encodeURIComponent(sharedCartId)}`;
  await setDoc(doc(db, "sharedCarts", sharedCartId), {
    sharedCartId,
    userId: selectedUserId,
    recipientEmail: recipientEmail || null,
    items: products.map((product) => {
      const row = productRows.find((entry) => entry.productId === product.id);
      return sharedCartItem(product, row?.quantity || 1);
    }),
    active: true,
    createdAt: serverTimestamp(),
    createdBy: auth?.currentUser?.uid || "admin",
    source: "admin-crm",
  });

  if (email) {
    const sendEmail = httpsCallable(functions, "sendAdminBroadcastEmail");
    const intro = escapeHTML(message || "A Recovery Tools cart has been prepared for you.");
    const htmlContent = [
      `<p>${intro}</p>`,
      `<p><a href="${link}">Review your cart and pay securely</a></p>`,
      "<p>Access is provided only after successful payment.</p>",
    ].join("");
    await sendEmail({
      recipients: [recipientEmail],
      subject: `Your Recovery Tools cart (${products.length} item${products.length === 1 ? "" : "s"})`,
      htmlContent,
    });
    showToast("Cart link emailed", "success");
  } else {
    await navigator.clipboard.writeText(link);
    showToast("Cart link copied", "success");
  }
}

async function grantManualProductAccess() {
  const productRows = selectedProductRows();
  const productIds = productRows.map((row) => row.productId);
  const reason = document.getElementById("manualUnlockReason")?.value;
  const reasonNote = document.getElementById("manualUnlockNote")?.value.trim();
  const products = accessProducts.filter((entry) => productIds.includes(entry.id));
  if (!selectedUserId || !products.length || !reason || !reasonNote) {
    return showToast("Select Products, a reason, and explain why access is being granted.", "error");
  }
  const productsWithoutGrants = products.filter((product) => !product.accessGrants.length);
  if (productsWithoutGrants.length) {
    return showToast("One or more selected Products have no canonical access targets.", "error");
  }
  await Promise.all(products.flatMap((product) => product.accessGrants.map(async (grant) => {
    const accessType = grant.accessEntityType || grant.accessType;
    const accessId = grant.accessEntityId || grant.accessId;
    if (!accessType || !accessId) return;
    const userAccessId = `${selectedUserId}_${accessType}_${accessId}`;
    const quantity = productRows.find((row) => row.productId === product.id)?.quantity || 1;
    await setDoc(doc(db, "userAccess", userAccessId), {
      userAccessId, userId: selectedUserId, accessType, accessId,
      sourceProductId: product.id,
      quantity,
      productAccessGrantId: grant.productAccessGrantId || grant.id,
      source: "admin-manual", manualGrantReason: reason, manualGrantNote: reasonNote,
      grantedAt: serverTimestamp(), grantedBy: auth?.currentUser?.uid || "admin",
      active: true, revokedAt: null, revokedBy: null, revocationReason: null,
      revocable: true, updatedAt: serverTimestamp(),
    }, { merge: true });
  })));
  showToast(`${products.length} Product${products.length === 1 ? "" : "s"} unlocked`, "success");
  await Promise.all(["Course", "Workshop", "Program"].map((type) => (
    renderUserAccess(selectedUserId, type)
  )));
}

async function addCrmNote() {
  const input = document.getElementById("crmNoteText");
  const text = input?.value.trim();
  if (!selectedUserId || !text) return showToast("Enter a note first.", "error");
  await addDoc(collection(db, `users/${selectedUserId}/notes`), {
    text,
    createdAt: serverTimestamp(),
    createdBy: "admin",
  });
  input.value = "";
  await renderUserCRMNotes(selectedUserId);
  showToast("Note added", "success");
}

export function setupRoleManager() {
  if (!document.getElementById(CRM_FORM_ID)) return;

  const form = document.getElementById(CRM_FORM_ID);
  if (form.dataset.initialized === "true") return;
  form.dataset.initialized = "true";
  const shippingFields = document.getElementById("crmShippingFields");
  const billingFields = document.getElementById("crmBillingFields");
  if (shippingFields) shippingFields.innerHTML = addressFieldsHtml("crmShipping");
  if (billingFields) billingFields.innerHTML = addressFieldsHtml("crmBilling");
  Promise.all([
    loadUsers(),
    loadAccessCatalog().then(() => loadCrmRelationships()),
  ]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const uid = document.getElementById("roleUid").value;
    const roles = {
      admin: document.getElementById("roleAdmin").checked,
      affiliate: document.getElementById("roleAffiliate").checked,
      therapist: document.getElementById("roleTherapist").checked,
    };
    if (!uid) return showToast("Select a user first.", "error");

    try {
      const setUserRoles = httpsCallable(functions, "setUserRoles");
      await setUserRoles({ uid, roles });
      const selected = crmUsers.find((user) => user.id === uid);
      if (selected) selected.roles = roles;
      showToast("Roles updated", "success");
    } catch (err) {
      console.error("Failed to update roles:", err);
      showToast("Error assigning roles", "error");
    }
  });

  const uidFromURL = new URLSearchParams(window.location.search).get("uid");
  if (uidFromURL) {
    selectUser(uidFromURL);
  }

  document.getElementById("resetPasswordBtn")?.addEventListener("click", resetUserPasswordAsAdmin);
  document.getElementById("crmApproveAffiliatePickupBtn")
    ?.addEventListener("click", approveCrmAffiliatePickup);
  document.getElementById("addCrmNoteBtn")?.addEventListener("click", addCrmNote);
  document.getElementById("createCrmCartLinkBtn")?.addEventListener("click", () => createSharedCart());
  document.getElementById("emailCrmCartLinkBtn")?.addEventListener("click", () => (
    createSharedCart({ email: true })
  ));
  document.getElementById("manualUnlockProductBtn")?.addEventListener("click", grantManualProductAccess);
  document.getElementById("addCrmProductRowBtn")?.addEventListener("click", () => addProductRow());
  document.getElementById("showManualUnlockBtn")?.addEventListener("click", () => showProductAction("manual"));
  document.getElementById("showSendCartBtn")?.addEventListener("click", () => showProductAction("cart"));
  document.getElementById("createCrmUserBtn")?.addEventListener("click", startCreateCrmUser);
  document.getElementById("saveCrmProfileBtn")?.addEventListener("click", async () => {
    try { await saveCrmProfile(); } catch (err) { console.error(err); showToast(err.message, "error"); }
  });
  document.getElementById("editSelectedCrmUserBtn")?.addEventListener("click", () => {
    const uids = checkedCrmUserIds();
    if (uids.length !== 1) return showToast("Select exactly one profile to edit.", "error");
    selectUser(uids[0]);
  });
  document.getElementById("archiveCrmUsersBtn")?.addEventListener("click", async () => {
    try { await archiveSelectedUsers(); } catch (err) { console.error(err); showToast(err.message, "error"); }
  });
  document.getElementById("mergeCrmUsersBtn")?.addEventListener("click", async () => {
    try { await mergeSelectedUsers(); } catch (err) { console.error(err); showToast(err.message, "error"); }
  });

  document.getElementById(USER_SELECT_ID)?.addEventListener("change", (event) => {
    if (event.target.value) selectUser(event.target.value);
  });

  ["crmStatusFilter", "crmRoleFilter", "crmContentFilter"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", applyCrmUserFilters);
  });
  document.getElementById("crmEngagementFilter")?.addEventListener("change", () => {
    updateCrmContentFilter();
    applyCrmUserFilters();
  });
  document.getElementById("clearCrmUserFiltersBtn")?.addEventListener("click", () => {
    document.getElementById(SEARCH_INPUT_ID).value = "";
    document.getElementById("crmStatusFilter").value = "active";
    document.getElementById("crmRoleFilter").value = "all";
    document.getElementById("crmEngagementFilter").value = "all";
    updateCrmContentFilter();
    applyCrmUserFilters();
  });

  document.getElementById(SEARCH_INPUT_ID)?.addEventListener("input", (e) => {
    if (e.target.value !== undefined) applyCrmUserFilters();
  });
}

async function resetUserPasswordAsAdmin() {
  const uid = document.getElementById("roleUid").value;
  const newPassword = document.getElementById("crmNewPassword").value;

  if (!uid || !newPassword) {
    return showToast("Enter a UID and new password", "error");
  }

  try {
    const resetPassword = httpsCallable(functions, "adminResetUserPassword");
    await resetPassword({ uid, newPassword });
    showToast("Password reset successfully", "success");
  } catch (err) {
    console.error("Error resetting password:", err);
    showToast(err.message, "error");
  }
}

async function selectUser(uid) {
  creatingCrmUser = false;
  document.getElementById("crmCreatePasswordRow")?.classList.add("hidden");
  document.getElementById("crmAccountSecurity")?.classList.remove("hidden");
  document.getElementById("saveCrmProfileBtn").textContent = "Save profile";
  let docSnap = await getDoc(doc(db, "users", uid));
  if (!docSnap.exists()) {
    const userQuery = await getDocs(query(collection(db, "users"), where("uid", "==", uid)));
    docSnap = userQuery.docs[0];
  }
  if (!docSnap) return showToast("User not found", "error");
  const user = docSnap.data();
  const resolvedUid = docSnap.id;
  selectedUserId = resolvedUid;
  let authoritativeRoles = {};
  try {
    const getUser = httpsCallable(functions, "getUserByEmailOrUID");
    const result = await getUser({ uid: resolvedUid });
    authoritativeRoles = result.data?.roles || {};
  } catch (err) {
    console.warn("Could not load Auth roles; using the CRM profile roles.", err);
  }
  const userWithRoles = {
    ...user,
    roles: {
      admin: roleEnabled(user, "admin") || authoritativeRoles.admin === true,
      affiliate: roleEnabled(user, "affiliate") || authoritativeRoles.affiliate === true,
      therapist: roleEnabled(user, "therapist") || authoritativeRoles.therapist === true,
    },
  };

  document.getElementById("roleUid").value = resolvedUid;
  document.getElementById("roleAdmin").checked = userWithRoles.roles.admin;
  document.getElementById("roleAffiliate").checked = userWithRoles.roles.affiliate;
  document.getElementById("roleTherapist").checked = userWithRoles.roles.therapist;
  document.getElementById(SELECTED_USER_PANEL_ID).classList.remove("hidden");
  document.getElementById("crmNoUserSelected")?.classList.add("hidden");
  document.getElementById("selectedUserName").textContent = displayName({ id: resolvedUid, ...user });
  document.getElementById("selectedUserMeta").textContent = `${user.email || "No email"} | ${resolvedUid}`;
  const roleProfiles = await Promise.all(["affiliates", "therapists"].map(async (collectionName) => {
    const snapshot = await getDoc(doc(db, collectionName, resolvedUid));
    if (snapshot.exists()) return snapshot.data();
    if (collectionName === "affiliates") {
      const matches = await getDocs(query(
        collection(db, "affiliates"),
        where("userId", "==", resolvedUid),
      ));
      return matches.docs[0]?.data() || {};
    }
    return {};
  }));
  const business = { ...roleProfiles[0], ...roleProfiles[1], ...user };
  document.getElementById("crmProfileName").value = user.name || user.displayName || user.fullName || "";
  document.getElementById("crmProfileEmail").value = user.email || "";
  document.getElementById("crmProfilePhone").value = user.phone || user.phoneNumber || "";
  fillAddress("crmShipping", normalizedAddress(user, "shipping"));
  fillAddress("crmBilling", normalizedAddress(user, "billing"));
  document.getElementById("crmBusinessName").value = business.businessName || "";
  document.getElementById("crmBusinessAbn").value = business.businessAbn || business.abn || "";
  document.getElementById("crmBusinessWebsite").value = business.businessWebsite || business.website || "";
  document.getElementById("crmBusinessEmail").value = business.businessEmail || "";
  document.getElementById("crmBusinessPhone").value = business.businessPhone || "";
  document.getElementById("crmBusinessAddress").value = business.businessAddress || "";
  const affiliateProfile = roleProfiles[0] || {};
  let pickupLocation = {};
  if (affiliateProfile.defaultPickupLocationId) {
    const pickupSnapshot = await getDoc(
      doc(db, "pickupLocations", affiliateProfile.defaultPickupLocationId),
    );
    if (pickupSnapshot.exists()) pickupLocation = pickupSnapshot.data() || {};
  }
  document.getElementById("crmAffiliatePickupEnabled").checked =
    affiliateProfile.pickupEnabled === true;
  document.getElementById("crmAffiliatePickupApproval").value =
    affiliateProfile.pickupApprovalStatus || "draft";
  document.getElementById("crmAffiliatePickupName").value = pickupLocation.locationName || "";
  document.getElementById("crmAffiliatePickupLine1").value = pickupLocation.addressLine1 || "";
  document.getElementById("crmAffiliatePickupLine2").value = pickupLocation.addressLine2 || "";
  document.getElementById("crmAffiliatePickupSuburb").value = pickupLocation.suburb || "";
  document.getElementById("crmAffiliatePickupState").value = pickupLocation.state || "";
  document.getElementById("crmAffiliatePickupPostcode").value = pickupLocation.postcode || "";
  document.getElementById("crmAffiliatePickupCountry").value =
    pickupLocation.country || "Australia";
  document.getElementById("crmAffiliatePickupFields")?.classList.toggle(
    "hidden",
    !userWithRoles.roles.affiliate,
  );
  document.getElementById("crmBusinessFields")?.classList.toggle(
    "hidden",
    !userWithRoles.roles.affiliate && !userWithRoles.roles.therapist,
  );
  const cartEmail = document.getElementById("crmCartRecipientEmail");
  if (cartEmail) cartEmail.value = user.email || "";
  const select = document.getElementById(USER_SELECT_ID);
  if (select && [...select.options].some((option) => option.value === resolvedUid)) select.value = resolvedUid;

  renderUserOrders(resolvedUid);
  renderUserCommunications(resolvedUid, user.email || "");
  renderUserWorkshops(resolvedUid);
  renderUserCourses(resolvedUid);
  renderUserPrograms(resolvedUid);
  renderUserCRMNotes(resolvedUid);
}

async function renderUserOrders(uid) {
  const snapshots = await Promise.all(["uid", "userId", "buyerUid"].map((field) => (
    getDocs(query(collection(db, "orders"), where(field, "==", uid)))
  )));
  const orders = [...new Map(snapshots.flatMap((snapshot) => snapshot.docs)
    .map((orderDoc) => [orderDoc.id, { id: orderDoc.id, ...orderDoc.data() }])).values()];

  const container = document.getElementById("userOrdersGrid");
  if (!container) return;
  container.innerHTML = "";

  if (!orders.length) container.innerHTML = "<p class='text-sm text-gray-400'>No orders found.</p>";
  orders.forEach((order) => {
    const div = document.createElement("div");
    div.className = "mb-2 min-w-0 cursor-pointer overflow-hidden rounded bg-gray-800 p-3 hover:bg-gray-700";
    div.innerHTML = `
      <div class="break-all"><strong>Invoice:</strong> ${escapeHTML(order.id)}</div>
      <div><strong>Status:</strong> ${escapeHTML(order.fulfilmentStatus || order.status || "Unknown")}</div>
      <div><strong>Total paid:</strong> ${formatCurrency(order.total ?? order.amountPaid ?? 0)}</div>
    `;
    div.addEventListener("click", () => {
      window.location.href = `/admin/orders?filter=${order.id}`;
    });
    container.appendChild(div);
  });
}

async function renderUserWorkshops(uid) {
  return renderUserAccess(uid, "Workshop");
}

async function renderUserCommunications(uid, email) {
  const container = document.getElementById("userCommunicationsList");
  if (!container) return;
  container.innerHTML = "<p class='text-sm text-gray-400'>Loading communication history...</p>";
  try {
    const [communicationResult, emailResult] = await Promise.all([
      httpsCallable(functions, "getCommunications")({ userId: uid, limit: 100 }),
      httpsCallable(functions, "getEmailLogs")({ userId: uid, email, limit: 100 }),
    ]);
    const records = communicationResult.data?.communications || [];
    const emailLogs = emailResult.data?.logs || [];
    const communicationMarkup = records.map((communication) => `
      <article class="rounded border border-gray-700 bg-gray-800 p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <strong>${escapeHTML(communication.subject || "Communication")}</strong>
          <span class="text-xs text-gray-400">${escapeHTML(communication.status || "open")}</span>
        </div>
        <div class="mt-1 text-xs text-gray-400">${escapeHTML(communication.contactEmail || email)} | ${escapeHTML(formatDateValue(communication.lastMessageAt))}</div>
        <div class="mt-2 space-y-2">${(communication.messages || []).map((message) => `
          <div class="rounded ${message.internal ? "bg-yellow-950/30" : "bg-gray-700"} p-2 text-sm">
            <div class="text-xs text-gray-400">${message.internal ? "Internal note" : message.direction === "outbound" ? "Admin reply" : "Customer message"}</div>
            <div class="mt-1 whitespace-pre-wrap break-words">${escapeHTML(message.bodyText || "")}</div>
          </div>`).join("")}</div>
        ${(communication.orderIds || []).length ? `<div class="mt-2 text-xs text-gray-400">Orders: ${escapeHTML(communication.orderIds.join(", "))}</div>` : ""}
        <a href="/admin/communications" class="admin-link mt-2 inline-block text-xs text-purple-300 hover:underline">Open in Communications</a>
      </article>`).join("");
    const communicationLogIds = new Set(records.flatMap((communication) =>
      (communication.messages || []).map((message) => message.emailLogId).filter(Boolean)));
    const standaloneEmails = emailLogs.filter((log) => !communicationLogIds.has(log.id));
    const emailMarkup = standaloneEmails.map((log) => `
      <div class="rounded border border-gray-700 bg-gray-900/60 p-2 text-sm">
        <div class="flex flex-wrap justify-between gap-2"><span>${escapeHTML(log.subject || log.type || "Email")}</span><span class="text-xs text-gray-400">${escapeHTML(log.status || "unknown")}</span></div>
        <div class="mt-1 text-xs text-gray-500">${escapeHTML(formatDateValue(log.createdAt))}${log.orderId ? ` | Order ${escapeHTML(log.orderId)}` : ""}</div>
      </div>`).join("");
    container.innerHTML = communicationMarkup || emailMarkup
      ? `<div class="space-y-3">${communicationMarkup}${emailMarkup ? `<div class="pt-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Other email activity</div>${emailMarkup}` : ""}</div>`
      : "<p class='text-sm text-gray-400'>No communication history found.</p>";
  } catch (error) {
    console.error("Failed to load user communications:", error);
    container.innerHTML = "<p class='text-sm text-red-300'>Unable to load communication history.</p>";
  }
}

async function renderUserCourses(uid) {
  return renderUserAccess(uid, "Course");
}

async function renderUserPrograms(uid) {
  return renderUserAccess(uid, "Program");
}

async function renderUserAccess(uid, accessType) {
  const container = document.getElementById(`user${accessType}List`);
  if (!container) return;
  const q = query(
    collection(db, "userAccess"),
    where("userId", "==", uid),
  );
  const accessSnapshot = await getDocs(q);
  const names = new Map(accessCatalog[accessType].map((entry) => [entry.id, entry.name]));
  const records = accessSnapshot.docs.filter((accessDoc) => {
    const data = accessDoc.data();
    const storedType = String(data.accessType || data.accessEntityType || "").toLowerCase();
    const accessId = data.accessId || data.accessEntityId;
    return storedType === accessType.toLowerCase() || names.has(accessId);
  });
  container.innerHTML = !records.length
    ? "<p class='text-sm text-gray-400'>None unlocked.</p>"
    : records.map((accessDoc) => {
      const data = accessDoc.data();
      const accessId = data.accessId || data.accessEntityId;
      const name = escapeHTML(names.get(accessId) || accessId);
      const revoked = data.active === false || Boolean(data.revokedAt);
      const status = revoked ? "Removed" : "Unlocked";
      return `<div class="mb-2 flex flex-wrap items-center justify-between gap-2 rounded
        bg-gray-700 p-2">
        <span><strong>${name}</strong> (${status})</span>
        <button type="button"
          class="crm-access-action rounded border border-purple-400 px-2 py-1 text-xs
            text-purple-100 hover:bg-purple-900/40"
          data-access-record-id="${escapeHTML(accessDoc.id)}"
          data-access-action="${revoked ? "restore" : "revoke"}">
          ${revoked ? "Restore access" : "Remove access"}
        </button>
      </div>`;
    }).join("");
  container.querySelectorAll(".crm-access-action").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.accessAction;
      const confirmed = action === "restore" || window.confirm(
        "Remove this access? The history will be retained and access can be restored later.",
      );
      if (!confirmed) return;
      button.disabled = true;
      try {
        const manageAccess = httpsCallable(functions, "manageUserAccess");
        await manageAccess({
          accessRecordId: button.dataset.accessRecordId,
          action,
        });
        showToast(action === "restore" ? "Access restored" : "Access removed", "success");
        await renderUserAccess(uid, accessType);
      } catch (error) {
        console.error("Failed to update user access:", error);
        showToast(error.message || "Could not update access", "error");
        button.disabled = false;
      }
    });
  });
}

async function renderUserCRMNotes(uid) {
  const q = query(collection(db, `users/${uid}/notes`));
  const snapshot = await getDocs(q);
  const container = document.getElementById("userNotesList");
  if (!container) return;
  const now = new Date();

  const notes = snapshot.docs.map((doc) => {
    const data = doc.data();
    const isUrgent = data.dueDate && new Date(data.dueDate) <= new Date(now.getTime() + 3 * 86400000);
    return `<li class="${isUrgent ? "text-yellow-400" : "text-white"}">
      ${escapeHTML(data.text)}${data.dueDate ? ` - Due: ${escapeHTML(data.dueDate)}` : ""}
    </li>`;
  });
  container.innerHTML = notes.join("");
}
