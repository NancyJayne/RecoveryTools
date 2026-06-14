
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import stripeLib from "stripe";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const RECAPTCHA_SECRET_KEY = defineSecret("RECAPTCHA_SECRET_KEY");

if (!admin.apps.length) {
  admin.initializeApp();
}

const verifyRecaptcha = async (token, context) => {
  if (!token) throw new HttpsError("invalid-argument", "Missing reCAPTCHA token");

  const recaptchaSecret =
    process.env.FUNCTIONS_EMULATOR === "true"
      ? process.env.RECAPTCHA_SECRET_KEY
      : context.secrets.RECAPTCHA_SECRET_KEY;

  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `secret=${recaptchaSecret}&response=${token}`,
  });

  const data = await res.json();
  if (!data.success || data.score < 0.5 || data.action !== "checkout") {
    console.warn("⚠ reCAPTCHA verification failed:", data);
    throw new HttpsError("permission-denied", "reCAPTCHA check failed");
  }
};

const createCheckoutSessionHandler = async (request) => {
  const uid = request.auth?.uid;
  const data = request.data || {};
  if (!uid) throw new HttpsError("unauthenticated", "User must be logged in.");

  const {
    cart,
    referrerId,
    collectShipping = false,
    customerInfo = {},
    saveAsDefaultShipping = false,
    token,
  } = data;

  if (!Array.isArray(cart) || cart.length === 0) {
    throw new HttpsError("invalid-argument", "Cart is empty or invalid.");
  }

  if (process.env.FUNCTIONS_EMULATOR !== "true") {
    await verifyRecaptcha(token, request);
  }

  const stripe = stripeLib(STRIPE_SECRET_KEY.value());
  const db = admin.firestore();

  try {
    // 🛒 Securely fetch product data from Firestore
    const productIds = cart.map((item) => item.id);
    const productDocs = await Promise.all(
      productIds.map((id) => db.collection("products").doc(id).get()),
    );

    const creatorIds = [
      ...new Set(
        productDocs
          .map((d) => d.data()?.creatorId)
          .filter((cId) => typeof cId === "string"),
      ),
    ];
    const creatorDocs = await Promise.all(
      creatorIds.map((cId) => db.collection("users").doc(cId).get()),
    );
    const creatorMap = Object.fromEntries(
      creatorDocs.map((d) => [d.id, d.data()?.stripeAccountId || null]),
    );

    const settingsSnap = await db
      .collection("settings")
      .doc("affiliateCommissions")
      .get();
    const commissionRates = settingsSnap.exists ? settingsSnap.data() : {};

    const validatedItems = productDocs.map((doc, i) => {
      if (!doc.exists) throw new HttpsError("not-found", `Product not found: ${productIds[i]}`);

      const data = doc.data();
      const quantity = cart[i].quantity || 1;
      const price = data.onSale && data.salePrice ? data.salePrice : data.price;

      if (!price || isNaN(price)) throw new HttpsError("invalid-argument", `Invalid price for: ${data.name}`);

      return {
        id: doc.id,
        name: data.name,
        image: data.images?.[0] || "https://via.placeholder.com/300",
        type: data.type || "item",
        price,
        quantity,
        creatorId: data.creatorId || null,
        stripeAccountId: creatorMap[data.creatorId] || null,
      };
    });

    // 💳 Stripe line items
    const lineItems = validatedItems.map((item) => ({
      price_data: {
        currency: "aud",
        unit_amount: Math.round(item.price * 100),
        product_data: {
          name: item.name,
          images: [item.image],
        },
      },
      quantity: item.quantity,
    }));

    const shippingCost = 1000;

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : {};

    let stripeCustomerId = userData.stripeCustomerId || null;

    const shippingAddress = {
      line1: customerInfo.shippingAddress_line1 || "",
      line2: customerInfo.shippingAddress_line2 || "",
      city: customerInfo.shippingAddress_city || "",
      state: customerInfo.shippingAddress_state || "",
      postal_code: customerInfo.shippingAddress_postcode || "",
      country: "AU",
    };

    const billingAddress = customerInfo.billingAddress
      ? {
        line1: customerInfo.billingAddress.line1 || "",
        line2: customerInfo.billingAddress.line2 || "",
        city: customerInfo.billingAddress.city || "",
        state: customerInfo.billingAddress.state || "",
        postal_code:
        customerInfo.billingAddress.postal_code ||
        customerInfo.billingAddress.postcode ||
        "",
        country: "AU",
      }
      : shippingAddress;
  
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: customerInfo.email || userData.email || request.auth?.token?.email,
        name: customerInfo.name || userData.name || "",
        phone: customerInfo.phone || userData.phone || "",
        shipping: {
          name: customerInfo.name || userData.name || "",
          phone: customerInfo.phone || userData.phone || "",
          address: shippingAddress,
        },
        metadata: {
          firebaseUID: uid,
        },
      });

      stripeCustomerId = customer.id;

      await userRef.set(
        {
          stripeCustomerId,
        },
        { merge: true },
      );
    } else {
      await stripe.customers.update(stripeCustomerId, {
        email: customerInfo.email || userData.email || request.auth?.token?.email,
        name: customerInfo.name || userData.name || "",
        phone: customerInfo.phone || userData.phone || "",
        shipping: {
          name: customerInfo.name || userData.name || "",
          phone: customerInfo.phone || userData.phone || "",
          address: shippingAddress,
        },
        metadata: {
          firebaseUID: uid,
        },
      });
    }

    // 🧾 Metadata for tracking and analytics
    const metadata = {
      firebaseUID: uid,
      shippingCost: shippingCost.toString(),
      saveAsDefaultShipping: saveAsDefaultShipping ? "true" : "false",
      ...(referrerId && { referrer_uid: referrerId }),
      ...(customerInfo.name && { customer_name: customerInfo.name }),
      ...(customerInfo.email && { customer_email: customerInfo.email }),
      ...(customerInfo.phone && { customer_phone: customerInfo.phone }),
      products: validatedItems.map((p) => `${p.type}:${p.name} x${p.quantity}`).join("; "),
    };

    const sessionConfig = {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url:
  process.env.FUNCTIONS_EMULATOR === "true"
    ? "http://localhost:5173/checkout?success=true&session_id={CHECKOUT_SESSION_ID}"
    : "https://recoverytools.au/checkout?success=true&session_id={CHECKOUT_SESSION_ID}",

      cancel_url:
    process.env.FUNCTIONS_EMULATOR === "true"
      ? "http://localhost:5173/cart"
      : "https://recoverytools.au/cart",
      metadata,

      customer: stripeCustomerId,

      phone_number_collection: {
        enabled: true,
      },

      shipping_address_collection: {
        allowed_countries: ["AU"],
      },

      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: {
              amount: shippingCost,
              currency: "aud",
            },
            display_name: "Standard Shipping",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 2 },
              maximum: { unit: "business_day", value: 5 },
            },
          },
        },
      ],
    };

    const primaryAccount = validatedItems[0]?.stripeAccountId;
    if (primaryAccount) {
      const totalFee = validatedItems.reduce((sum, item) => {
        const rate = commissionRates[item.type] ?? 0.1;
        return sum + Math.round(item.price * 100 * item.quantity * rate);
      }, 0);
      sessionConfig.payment_intent_data = {
        transfer_data: { destination: primaryAccount },
        application_fee_amount: totalFee,
      };
    }

    if (collectShipping) {
      sessionConfig.shipping_address_collection = {
        allowed_countries: ["AU"],
      };
      sessionConfig.phone_number_collection = { enabled: true };
      sessionConfig.shipping_options = [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: shippingCost, currency: "aud" },
            display_name: "Standard Shipping",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 2 },
              maximum: { unit: "business_day", value: 5 },
            },
          },
        },
      ];
    }

    // ✅ Store checkout info for reuse
    if (saveAsDefaultShipping) {
      await userRef.set(
        {
          name: customerInfo.name || userData.name || "",
          phone: customerInfo.phone || userData.phone || "",
          address: customerInfo.shippingAddress_line1 || "",
          billingAddress: billingAddress.line1 || "",
          defaultShippingAddress: shippingAddress,
          defaultBillingAddress: billingAddress,
          checkoutProfile: customerInfo,
        },
        { merge: true },
      );
    }

    console.log("Customer phone sent to Stripe:", customerInfo.phone);
    console.log("saveAsDefaultShipping:", saveAsDefaultShipping);

    console.log(
      "Checkout config:",
      JSON.stringify(sessionConfig, null, 2),
    );
    const session = await stripe.checkout.sessions.create(sessionConfig);
    return { id: session.id, url: session.url };

  } catch (err) {
    console.error("Unable to create checkout session:", err);

    await db.collection("logs").add({
      type: "error",
      message: err.message,
      stack: err.stack || null,
      source: "createCheckoutSession",
      metadata: {
        uid,
        cartLength: cart?.length || 0,
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    throw new HttpsError(
      "internal",
      "Unable to create checkout session.",
    );
  }
};

export const createCheckoutSession = onCall(
  {
    region: "australia-southeast1",
    secrets: [STRIPE_SECRET_KEY, RECAPTCHA_SECRET_KEY],
  },
  createCheckoutSessionHandler,
);
