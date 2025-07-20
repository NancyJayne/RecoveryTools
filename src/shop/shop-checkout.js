// Refactored shop-checkout.js – Shortened lines, removed unused vars, retained structure

import { auth, db, functions } from "../utils/firebase-config.js";
import { getCurrentCart } from "./shop-cart.js";
import { showToast, formatCurrency } from "../utils/utils.js";
import { confirmOrderFromStripeRedirect } from "./shop-orders.js";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { executeRecaptcha } from "../utils/verifyRecaptchaToken.js";

let user = auth?.currentUser;


export async function setupCheckoutPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const isSuccess = urlParams.get("success") === "true";
  const summaryContainer = document.getElementById("checkoutSummary");
  const confirmBtn = document.getElementById("checkoutBtn");
  if (!summaryContainer) return;

  if (isSuccess) {
    confirmOrderFromStripeRedirect()
      .then((order) => {
        const hasCourse = order.products.some((p) => p.type === "course");

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
        orderId.innerHTML = `Order ID: <strong>${order?.invoiceId || "N/A"}</strong>`;

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

        order.products.forEach((item) => {
          const line = document.createElement("div");
          line.className =
            "flex justify-between border-b border-gray-700 py-2 text-sm";

          const left = document.createElement("div");

          const name = document.createElement("div");
          name.className = "font-semibold";
          name.textContent = item.name;

          const typeQty = document.createElement("div");
          typeQty.className = "text-gray-400";
          typeQty.textContent = `${item.type?.toUpperCase() || "ITEM"} x${item.quantity}`;

          left.append(name, typeQty);

          const right = document.createElement("div");
          right.textContent = formatCurrency((item.price * item.quantity) / 100);

          line.append(left, right);
          orderSummary.appendChild(line);
        });

        const summaryLines = [
          { label: "Subtotal", value: formatCurrency(order.subtotal / 100) },
          {
            label: "Shipping",
            value: formatCurrency((order.shipping?.amount_total || 1000) / 100),
          },
          { label: "GST", value: formatCurrency(order.total / 11) },
          {
            label: "Total",
            value: formatCurrency(order.total / 100),
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

        const sendEmail = functions.httpsCallable("sendTransactionalEmail");
        sendEmail({
          to: order.userEmail,
          templateId: "d-4b0e5696c6a14a67892e586f385b6e7d",
          dynamicTemplateData: {
            first_name: order?.userName?.split(" ")[0] || "Customer",
            order_id: order?.invoiceId,
            order_items: order.products.map((p) => ({
              name: p.name,
              quantity: p.quantity,
              type: p.type || "Item",
              price: formatCurrency(p.price / 100),
              accessUrl:
                p.type === "course"
                  ? `https://recoverytools.au/courses/${p.productId}`
                  : null,
            })),
            total: formatCurrency(order.total / 100),
            shipping_cost: formatCurrency(
              (order.shipping?.amount_total || 1000) / 100,
            ),
            shipping_name: order.shipping?.name || order.userName || "",
            shipping_address: {
              line1: order.shipping?.address?.line1 || "",
              line2: order.shipping?.address?.line2 || "",
              city: order.shipping?.address?.city || "",
              state: order.shipping?.address?.state || "",
              postcode: order.shipping?.address?.postal_code || "",
              country: order.shipping?.address?.country || "AU",
            },
            invoice_url: order.invoiceUrl || "https://recoverytools.au/profile",
            unsubscribe_url: "https://recoverytools.au/unsubscribe",
            show_course_button: hasCourse,
            course_button_url: hasCourse
              ? "https://recoverytools.au/courses"
              : "",
          },
        });
      })
      .catch(() => {
        summaryContainer.innerHTML =
          "<p class='text-red-500'>⚠ Something went wrong confirming your order.</p>";
      });
    return;
  }

  if (!confirmBtn) return;

  const cart = getCurrentCart();
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

  user = auth?.currentUser; // reuse outer `let user`
  let profileData = {};
  if (user) {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    profileData = userDoc.exists() ? userDoc.data().checkoutProfile || {} : {};
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

  nameEmailGroup.append(nameWrapper, emailWrapper);
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
  form.appendChild(shippingGroup);

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
  form.appendChild(toggleWrapper);

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
  form.appendChild(billingContainer);

  // 🔄 Toggle billing section visibility
  const toggleCheckbox = form.querySelector("#sameAsShipping");
  toggleCheckbox?.addEventListener("change", (e) => {
    const isSame = e.target.checked;
    billingContainer.classList.toggle("hidden", isSame);
    billingGroup.querySelectorAll("input").forEach((input) => {
      input.disabled = isSame;
    });
  });

  const createFieldRow = (labelText, value) => {
    const row = document.createElement("div");
    row.className = "flex justify-between border-b border-gray-700 py-2 text-sm";

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
    const totalPrice = (item.price * item.quantity) / 100;
    subtotal += totalPrice;
    const itemLabel = `${item.type?.toUpperCase() || "ITEM"} x${item.quantity}`;
    const labelText = `${item.name} (${itemLabel})`;
    cartSummary.appendChild(createFieldRow(labelText, formatCurrency(totalPrice)));
  });

  const shippingCost = 1000; // Default flat shipping
  const gst = subtotal / 11;
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
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Processing...";

    const formData = new FormData(form);
    const customerInfo = Object.fromEntries(formData.entries());

    if (form.querySelector("#sameAsShipping")?.checked) {
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

    if (user) {
      try {
        await setDoc(
          doc(db, "users", user.uid),
          { checkoutProfile: customerInfo },
          { merge: true },
        );
      } catch (err) {
        console.warn("⚠ Failed to save checkout profile:", err);
      }
    }

    try {
      const token = await executeRecaptcha("checkout");
      const createCheckout = functions.httpsCallable("createCheckoutSession");
      const response = await createCheckout({
        cart,
        referrerId: localStorage.getItem("referrer_uid") || null,
        collectShipping: true,
        customerInfo,
        token,
      });

      const session = response.data;
      if (session?.id) {
        sessionStorage.setItem("cartBackup", JSON.stringify(cart));
        window.location.href = `https://checkout.stripe.com/c/pay/${session.id}`;
      } else {
        showToast("Failed to initiate checkout session.", "error");
      }
    } catch (error) {
      console.error("❌ Stripe Checkout error:", error);
      showToast("Unable to start checkout.", "error");
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Checkout";
    }
  });
}

export default setupCheckoutPage;