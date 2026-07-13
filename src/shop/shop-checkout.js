// Refactored shop-checkout.js – Shortened lines, removed unused vars, retained structure

import { auth, db, functions } from "../utils/firebase-config.js";
import { httpsCallable } from "firebase/functions";
import { getCurrentCart } from "./shop-cart.js";
import { showToast, formatCurrency } from "../utils/utils.js";
import { confirmOrderFromStripeRedirect } from "./shop-orders.js";
import { doc, getDoc } from "firebase/firestore";
import { executeRecaptcha } from "../utils/verifyRecaptchaToken.js";
import { onAuthStateChanged } from "firebase/auth";

function asDollars(value) {
  const amount = Number(value || 0);
  return amount > 1000 ? amount / 100 : amount;
}

function orderItems(order) {
  return Array.isArray(order?.products) ? order.products : [];
}

function itemName(item) {
  return item.name || item.productTitle || "Item";
}

function itemType(item) {
  return item.type || item.productType || "item";
}

function itemLineTotal(item) {
  if (item.lineTotal !== undefined) return Number(item.lineTotal || 0);
  return asDollars(item.price || item.unitPrice) * Number(item.quantity || 1);
}

function itemRequiresShipping(item) {
  return item.requiresShipping === true;
}

async function waitForAuth() {
  if (auth?.currentUser) return auth.currentUser;

  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u);
    });
  });
}


export async function setupCheckoutPage() {
  document.getElementById("checkoutSection")?.classList.remove("hidden");
  const user = await waitForAuth();

  const urlParams = new URLSearchParams(window.location.search);
  const isSuccess = urlParams.get("success") === "true";
  const summaryContainer = document.getElementById("checkoutSummary");
  const confirmBtn = document.getElementById("checkoutBtn");
  const checkoutActions = document.getElementById("checkoutActions");
  if (!summaryContainer) return;

  if (isSuccess) {
    checkoutActions?.remove();
    summaryContainer.innerHTML = `
      <div class="text-center py-12 px-4">
        <div
          class="w-12 h-12 border-4 border-gray-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"
        ></div>
        <p class="text-gray-300">Confirming your order...</p>
      </div>
    `;

    confirmOrderFromStripeRedirect()
      .then((order) => {
        if (!order) return;
        const items = orderItems(order);

        const summaryBox = document.createElement("div");
        summaryBox.className = "text-center py-12 px-4 sm:px-6 lg:px-8";

        const emoji = document.createElement("div");
        emoji.className = "text-5xl mb-4 text-green-400";
        emoji.textContent = "🎉";

        const heading = document.createElement("h2");
        heading.className = "text-3xl font-bold text-white mb-2";
        heading.textContent = "Your order is confirmed!";

        const thanks = document.createElement("p");
        thanks.className = "text-gray-300 mb-1";
        thanks.textContent = "Thanks! A receipt has been emailed.";

        const orderId = document.createElement("p");
        orderId.className = "text-gray-400 text-sm";
        orderId.innerHTML = `Order ID: <strong>${order?.invoiceId || order?.orderId || "N/A"}</strong>`;

        const continueLink = document.createElement("a");
        continueLink.href = "/shop";
        continueLink.className =
          "mt-6 inline-block bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded";
        continueLink.textContent = "Continue Shopping";

        summaryBox.append(emoji, heading, thanks, orderId, continueLink);
        summaryContainer.innerHTML = "";
        summaryContainer.appendChild(summaryBox);

        const orderSummary = document.createElement("div");
        orderSummary.className =
          "bg-gray-900 p-6 mt-8 rounded-lg shadow text-white text-left max-w-xl mx-auto";

        const headingSummary = document.createElement("h3");
        headingSummary.className = "text-xl font-bold mb-4";
        headingSummary.textContent = "Order Summary";
        orderSummary.appendChild(headingSummary);

        items.forEach((item) => {
          const line = document.createElement("div");
          line.className =
            "flex justify-between border-b border-gray-700 py-2 text-sm";

          const left = document.createElement("div");

          const name = document.createElement("div");
          name.className = "font-semibold";
          name.textContent = itemName(item);

          const typeQty = document.createElement("div");
          typeQty.className = "text-gray-400";
          typeQty.textContent = `${itemType(item).toUpperCase()} x${item.quantity}`;

          left.append(name, typeQty);

          const right = document.createElement("div");
          right.textContent = formatCurrency(itemLineTotal(item));

          line.append(left, right);
          orderSummary.appendChild(line);
        });

        const summaryLines = [
          { label: "Subtotal", value: formatCurrency(asDollars(order.subtotal)) },
          {
            label: "Shipping",
            value: formatCurrency(asDollars(order.shippingAmount ?? order.shipping?.amount_total ?? 0)),
          },
          { label: "GST", value: formatCurrency(order.gstAmount ?? (asDollars(order.total) / 11)) },
          {
            label: "Total",
            value: formatCurrency(asDollars(order.total)),
            bold: true,
          },
        ];

        summaryLines.forEach(({ label, value, bold }) => {
          const line = document.createElement("div");
          line.className = `text-right text-sm text-gray-400 mt-1${
            bold ? " text-lg font-bold text-white" : ""
          }`;
          line.textContent = `${label}: ${value}`;
          orderSummary.appendChild(line);
        });

        summaryContainer.appendChild(orderSummary);

      })
      .catch(() => {
        summaryContainer.innerHTML =
          "<p class='text-red-500'>⚠ Something went wrong confirming your order.</p>";
      });
    return;
  }

  if (!confirmBtn) return;

  const cart = getCurrentCart();
  const hasShippingItems = cart.some(itemRequiresShipping);
  if (!cart.length) {
    summaryContainer.innerHTML =
      "<p class='text-red-500'>Your cart is empty.</p>";
    confirmBtn.disabled = true;
    return;
  }

  summaryContainer.innerHTML = "";

  const form = document.createElement("form");
  form.className = "space-y-4";
  summaryContainer.appendChild(form);

  let profileData = {};

  if (user) {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    const data = userDoc.exists() ? userDoc.data() : {};
    const savedCheckout = data.checkoutProfile || {};

    profileData = {
      ...savedCheckout,

      name: data.name || savedCheckout.name || user.displayName || "",
      email: data.email || savedCheckout.email || user.email || "",
      phone: data.phone || savedCheckout.phone || "",

      shippingAddress_line1:
    savedCheckout.shippingAddress_line1 ||
    data.defaultShippingAddress?.line1 ||
    "",

      shippingAddress_line2:
    savedCheckout.shippingAddress_line2 ||
    data.defaultShippingAddress?.line2 ||
    "",

      shippingAddress_city:
    savedCheckout.shippingAddress_city ||
    data.defaultShippingAddress?.city ||
    "",

      shippingAddress_state:
    savedCheckout.shippingAddress_state ||
    data.defaultShippingAddress?.state ||
    "",

      shippingAddress_postcode:
    savedCheckout.shippingAddress_postcode ||
    data.defaultShippingAddress?.postal_code ||
    "",

      shippingAddress_country:
    savedCheckout.shippingAddress_country ||
    data.defaultShippingAddress?.country ||
    "Australia",

      billingAddress_line1:
    savedCheckout.billingAddress_line1 ||
    data.defaultBillingAddress?.line1 ||
    "",

      billingAddress_line2:
    savedCheckout.billingAddress_line2 ||
    data.defaultBillingAddress?.line2 ||
    "",

      billingAddress_city:
    savedCheckout.billingAddress_city ||
    data.defaultBillingAddress?.city ||
    "",

      billingAddress_state:
    savedCheckout.billingAddress_state ||
    data.defaultBillingAddress?.state ||
    "",

      billingAddress_postcode:
    savedCheckout.billingAddress_postcode ||
    data.defaultBillingAddress?.postal_code ||
    "",

      billingAddress_country:
    savedCheckout.billingAddress_country ||
    data.defaultBillingAddress?.country ||
    "Australia",
    };
  }

  // 👤 Full Name and Email Section
  const nameEmailGroup = document.createElement("div");
  nameEmailGroup.className = "grid grid-cols-1 md:grid-cols-2 gap-4";

  const nameWrapper = document.createElement("div");
  const nameLabel = document.createElement("label");
  nameLabel.htmlFor = "name";
  nameLabel.className = "block text-sm font-medium text-white";
  nameLabel.textContent = "Full Name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.name = "name";
  nameInput.id = "name";
  nameInput.autocomplete = "name";
  nameInput.required = true;
  nameInput.className =
    "mt-1 block w-full bg-gray-800 border border-gray-700 text-white rounded-md px-3 py-2";
  nameInput.value = profileData.name || "";
  nameWrapper.append(nameLabel, nameInput);

  const emailWrapper = document.createElement("div");
  const emailLabel = document.createElement("label");
  emailLabel.htmlFor = "email";
  emailLabel.className = "block text-sm font-medium text-white";
  emailLabel.textContent = "Email";
  const emailInput = document.createElement("input");
  emailInput.type = "email";
  emailInput.name = "email";
  emailInput.id = "email";
  emailInput.autocomplete = "email";
  emailInput.required = true;
  emailInput.className =
    "mt-1 block w-full bg-gray-800 border border-gray-700 text-white rounded-md px-3 py-2";
  emailInput.value = profileData.email || "";
  emailWrapper.append(emailLabel, emailInput);

  const phoneWrapper = document.createElement("div");
  const phoneLabel = document.createElement("label");
  phoneLabel.htmlFor = "phone";
  phoneLabel.className = "block text-sm font-medium text-white";
  phoneLabel.textContent = "Phone";

  const phoneInput = document.createElement("input");
  phoneInput.type = "tel";
  phoneInput.name = "phone";
  phoneInput.id = "phone";
  phoneInput.autocomplete = "tel";
  phoneInput.required = true;
  phoneInput.className =
  "mt-1 block w-full bg-gray-800 border border-gray-700 text-white rounded-md px-3 py-2";
  phoneInput.value = profileData.phone || "";

  phoneWrapper.append(phoneLabel, phoneInput);

  nameEmailGroup.append(nameWrapper, emailWrapper, phoneWrapper);
  form.appendChild(nameEmailGroup);

  // 📦 Shipping Address Section
  const shippingGroup = document.createElement("div");
  shippingGroup.className = "grid grid-cols-1 md:grid-cols-2 gap-4";
  const shippingFields = [
    { id: "shippingAddress_line1", label: "Address Line 1", required: true },
    { id: "shippingAddress_line2", label: "Address Line 2" },
    { id: "shippingAddress_city", label: "City", required: true },
    { id: "shippingAddress_state", label: "State", required: true },
    { id: "shippingAddress_postcode", label: "Postcode", required: true },
    {
      id: "shippingAddress_country",
      label: "Country",
      required: true,
      defaultValue: "Australia",
    },
  ];
  shippingFields.forEach(({ id, label, required, defaultValue }) => {
    const div = document.createElement("div");
    div.innerHTML = `
      <label for="${id}" class="block text-sm font-medium text-white">${label}</label>
      <input type="text" name="${id}" id="${id}" ${required ? "required" : ""}
        class="mt-1 block w-full bg-gray-800 border border-gray-700 text-white rounded-md px-3 py-2"
        value="${profileData[id] || defaultValue || ""}" />
    `;
    shippingGroup.appendChild(div);
  });
  if (hasShippingItems) {
    form.appendChild(shippingGroup);
  }

  const toggleWrapper = document.createElement("div");
  toggleWrapper.className = "mt-6";
  toggleWrapper.innerHTML = `
    <label class="inline-flex items-center text-white">
      <input
        type="checkbox"
        id="sameAsShipping"
        class="form-checkbox bg-gray-800 border-gray-700 text-green-500"
        checked
      />
      <span class="ml-2">Billing address same as shipping</span>
    </label>
  `;
  if (hasShippingItems) {
    form.appendChild(toggleWrapper);
  }

  const billingContainer = document.createElement("div");
  billingContainer.id = "billingAddressContainer";
  billingContainer.className = "mt-6 hidden";

  const billingHeader = document.createElement("h4");
  billingHeader.className = "text-white";
  billingHeader.textContent = "Billing Address";
  billingContainer.appendChild(billingHeader);

  const billingGroup = document.createElement("div");
  billingGroup.className = "grid grid-cols-1 md:grid-cols-2 gap-4";

  shippingFields.forEach(({ id, label, required, defaultValue }) => {
    const billingId = id.replace("shippingAddress", "billingAddress");
    const div = document.createElement("div");
    div.innerHTML = `
      <label for="${billingId}" class="block text-sm font-medium text-white">${label}</label>
      <input type="text" name="${billingId}" id="${billingId}" ${required ? "required" : ""}
        class="mt-1 block w-full bg-gray-800 border border-gray-700 text-white rounded-md px-3 py-2"
        value="${profileData[billingId] || defaultValue || ""}" />
    `;
    billingGroup.appendChild(div);
  });

  billingContainer.appendChild(billingGroup);
  if (hasShippingItems) {
    form.appendChild(billingContainer);
  }

  // 🔄 Toggle billing section visibility
  const toggleCheckbox = form.querySelector("#sameAsShipping");
  billingGroup.querySelectorAll("input").forEach((input) => {
    input.disabled = toggleCheckbox?.checked ?? true;
  });

  toggleCheckbox?.addEventListener("change", (e) => {
    const isSame = e.target.checked;
    billingContainer.classList.toggle("hidden", isSame);

    billingGroup.querySelectorAll("input").forEach((input) => {
      input.disabled = isSame;
    });
  });

  // 💾 Save as default shipping address
  const saveDefaultWrapper = document.createElement("div");
  saveDefaultWrapper.className = "mt-4";

  saveDefaultWrapper.innerHTML = `
  <label class="inline-flex items-center text-white">
    <input
      type="checkbox"
      id="saveAsDefaultShipping"
      class="form-checkbox bg-gray-800 border-gray-700 text-green-500"
    />
    <span class="ml-2">
      Save this as my default shipping address
    </span>
  </label>
`;

  if (hasShippingItems) {
    form.appendChild(saveDefaultWrapper);
  }

  // -------------------------------
  // Order Summary
  // -------------------------------

  const createFieldRow = (labelText, value) => {
    const row = document.createElement("div");
    row.className =
    "flex justify-between border-b border-gray-700 py-2 text-sm";

    const left = document.createElement("div");

    const label = document.createElement("div");
    label.className = "font-semibold";
    label.textContent = labelText;

    left.appendChild(label);

    const right = document.createElement("div");
    right.textContent = value;

    row.append(left, right);

    return row;
  };

  const cartSummary = document.createElement("div");
  cartSummary.className =
    "bg-gray-900 p-6 mt-8 rounded-lg shadow text-white text-left max-w-xl mx-auto";

  const summaryHeading = document.createElement("h3");
  summaryHeading.className = "text-xl font-bold mb-4";
  summaryHeading.textContent = "Order Summary";
  cartSummary.appendChild(summaryHeading);

  let subtotal = 0;
  cart.forEach((item) => {
    const totalPrice = item.price * item.quantity;
    subtotal += totalPrice;
    const itemLabel = `${item.type?.toUpperCase() || "ITEM"} x${item.quantity}`;
    const labelText = `${item.name} (${itemLabel})`;
    cartSummary.appendChild(createFieldRow(labelText, formatCurrency(totalPrice)));
  });

  const shippingCost = hasShippingItems ? 10 : 0;
  const gst = (subtotal + shippingCost) / 11;
  const total = subtotal + shippingCost;

  cartSummary.appendChild(createFieldRow("Subtotal", formatCurrency(subtotal)));
  cartSummary.appendChild(createFieldRow("Shipping", formatCurrency(shippingCost)));
  cartSummary.appendChild(createFieldRow("GST", formatCurrency(gst)));
  const totalRow = createFieldRow("Total", formatCurrency(total));
  totalRow.classList.add("text-lg", "font-bold", "text-white");
  cartSummary.appendChild(totalRow);


  summaryContainer.appendChild(cartSummary);
  confirmBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    confirmBtn.disabled = true;
    confirmBtn.textContent = "Processing...";

    const formData = new FormData(form);
    const customerInfo = Object.fromEntries(formData.entries());
    const phoneDigits = String(customerInfo.phone || "").replace(/\D/g, "");
    if (hasShippingItems && (!phoneDigits || phoneDigits.length < 8)) {
      showToast("Enter a recipient phone number for parcel delivery.", "error");
      form.querySelector("#phone")?.focus();
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Checkout";
      return;
    }

    const saveAsDefaultShipping =
  form.querySelector("#saveAsDefaultShipping")?.checked || false;

    if (!hasShippingItems) {
      customerInfo.billingAddress = {};
    } else if (form.querySelector("#sameAsShipping")?.checked) {
      customerInfo.billingAddress = {
        line1: customerInfo.shippingAddress_line1,
        line2: customerInfo.shippingAddress_line2,
        city: customerInfo.shippingAddress_city,
        state: customerInfo.shippingAddress_state,
        postcode: customerInfo.shippingAddress_postcode,
        country: customerInfo.shippingAddress_country,
      };
    } else {
      customerInfo.billingAddress = {
        line1: customerInfo.billingAddress_line1,
        line2: customerInfo.billingAddress_line2,
        city: customerInfo.billingAddress_city,
        state: customerInfo.billingAddress_state,
        postcode: customerInfo.billingAddress_postcode,
        country: customerInfo.billingAddress_country,
      };
    }

    try {
      const token = await executeRecaptcha("checkout");
      const createCheckout = httpsCallable(functions, "createCheckoutSession");
      const response = await createCheckout({
        cart,
        referrerId: localStorage.getItem("referrer_uid") || null,
        collectShipping: hasShippingItems,
        customerInfo,
        saveAsDefaultShipping,
        token,
      });

      const session = response.data;
      if (session?.url) {
        sessionStorage.setItem("cartBackup", JSON.stringify(cart));
        window.location.href = session.url;
      } else {
        showToast("Failed to initiate checkout session.", "error");
      }
    } catch (error) {
      console.error("Unable to start checkout:", error);
      showToast("Unable to start checkout.", "error");
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Checkout";
    }
  });
}

export default setupCheckoutPage;
