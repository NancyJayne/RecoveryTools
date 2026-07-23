
import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import stripeLib from "stripe";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";
import { appBaseUrl, stripeSecretValue } from "../utils/stripeEnvironment.js";
import {
  accessGrantsForProduct,
  loadProductArchitecture,
  mediaForProduct,
  productDisplayName,
  productDisplayType,
  variantForProduct,
} from "../utils/productArchitecture.js";
import {
  pickupLocationMetadata,
  resolveSelectedPickupLocation,
} from "./pickupLocations.js";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_SECRET_KEY_TEST = defineSecret("STRIPE_SECRET_KEY_TEST");
const RECAPTCHA_SECRET_KEY = defineSecret("RECAPTCHA_SECRET_KEY");

if (!admin.apps.length) {
  admin.initializeApp();
}

const verifyRecaptcha = async (token) => {
  if (!token) throw new HttpsError("invalid-argument", "Missing reCAPTCHA token");

  const recaptchaSecret =
    process.env.FUNCTIONS_EMULATOR === "true"
      ? process.env.RECAPTCHA_SECRET_KEY
      : RECAPTCHA_SECRET_KEY.value();

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

function firstImage(data) {
  const mediaImage = Array.isArray(data.media)
    ? data.media.find((asset) => asset?.type === "image")?.url
    : "";
  return data.images?.[0] || mediaImage || data.image || data.imageUrl || "https://via.placeholder.com/300";
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanEmail(value) {
  return cleanString(value).toLowerCase();
}

function hasValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

function hasValidPhone(value) {
  return cleanString(value).replace(/\D/g, "").length >= 8;
}

function normalizeAuCountry(value) {
  const country = cleanString(value);
  return country.toUpperCase() === "AU" || country.toLowerCase() === "australia" ? "AU" : country;
}

function normalizeShippingAddress(customerInfo = {}) {
  return {
    line1: cleanString(customerInfo.shippingAddress_line1),
    line2: cleanString(customerInfo.shippingAddress_line2),
    city: cleanString(customerInfo.shippingAddress_city),
    state: cleanString(customerInfo.shippingAddress_state).toUpperCase(),
    postal_code: cleanString(customerInfo.shippingAddress_postcode),
    country: normalizeAuCountry(customerInfo.shippingAddress_country || "AU"),
  };
}

function normalizeBillingAddress(customerInfo = {}) {
  const address = customerInfo.billingAddress || {};
  return {
    line1: cleanString(address.line1),
    line2: cleanString(address.line2),
    city: cleanString(address.city),
    state: cleanString(address.state).toUpperCase(),
    postal_code: cleanString(address.postal_code || address.postcode),
    country: normalizeAuCountry(address.country || "AU"),
  };
}

function assertPhysicalCheckoutDetails({ contact, shippingAddress }) {
  const missing = [];
  if (!contact.name) missing.push("recipient name");
  if (!hasValidEmail(contact.email)) missing.push("recipient email");
  if (!hasValidPhone(contact.phone)) missing.push("recipient phone");
  if (!shippingAddress.line1) missing.push("shipping address line 1");
  if (!shippingAddress.city) missing.push("shipping city");
  if (!shippingAddress.state) missing.push("shipping state");
  if (!shippingAddress.postal_code) missing.push("shipping postcode");
  if (shippingAddress.country !== "AU") missing.push("Australian shipping country");

  if (missing.length) {
    throw new HttpsError(
      "invalid-argument",
      `Physical products require ${missing.join(", ")} for domestic parcel delivery.`,
    );
  }
}

function normalizedShippingZones(settings = {}) {
  const rawZones = settings.shippingZones;
  if (Array.isArray(rawZones)) return rawZones;
  if (rawZones && typeof rawZones === "object") return Object.values(rawZones);
  return [];
}

function shippingQuote(settings, subtotal, hasPhysicalItems) {
  if (!hasPhysicalItems) return { costInCents: 0, label: "Shipping" };
  const zones = normalizedShippingZones(settings);
  const zone = zones.find((entry) => entry?.default) || zones[0] || {};
  const rate = Math.max(0, Number(zone.rate ?? 10));
  const freeShippingMin = Math.max(0, Number(settings.freeShippingMin || 0));
  const isFree = freeShippingMin > 0 && subtotal >= freeShippingMin;
  return {
    costInCents: isFree ? 0 : Math.round(rate * 100),
    label: isFree ? "Free Australian shipping" : zone.label || "Standard Australian shipping",
  };
}

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
    await verifyRecaptcha(token);
  }

  const stripe = stripeLib(stripeSecretValue({
    liveSecret: STRIPE_SECRET_KEY,
    testSecret: STRIPE_SECRET_KEY_TEST,
  }));

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
    const shopSettingsSnap = await db.collection("settings").doc("shop").get();
    const shopSettings = shopSettingsSnap.exists ? shopSettingsSnap.data() || {} : {};

    const architecture = await loadProductArchitecture(db);

    const validatedItems = await Promise.all(productDocs.map(async (doc, i) => {
      if (!doc.exists) throw new HttpsError("not-found", `Product not found: ${productIds[i]}`);

      const data = doc.data();
      const shopStatus = cleanString(data.shopStatus).toLowerCase();
      if (data.archived === true || data.visible === false || shopStatus === "archived") {
        throw new HttpsError("failed-precondition", `${data.name || doc.id} is no longer available.`);
      }
      const quantity = cart[i].quantity || 1;
      const variantId = cleanString(cart[i].variantId);
      const variant = variantForProduct(doc.id, data.itemId || data.legacyItemId || "", variantId, architecture);
      if (variantId && !variant) {
        throw new HttpsError("invalid-argument", `Invalid variant for: ${data.name || doc.id}`);
      }
      const productPrice = data.onSale && data.salePrice
        ? data.salePrice
        : data.basePrice ?? data.price ?? data.priceFrom;
      const price = variant?.priceOverride ?? productPrice;
      const baseName = productDisplayName(data, doc.id);
      const variantName = variant?.name || [variant?.colour, variant?.size].filter(Boolean).join(" / ");
      const name = variantName ? `${baseName} - ${variantName}` : baseName;
      const media = mediaForProduct(doc.id, data, architecture);
      const image = media.find((asset) => asset.type === "image")?.url || firstImage(data);
      const accessGrants = accessGrantsForProduct(doc.id, data, architecture);
      const configuredFulfilment = variant?.physicalFulfilment || data.physicalFulfilment ||
        (data.requiresShipping === true ? "shipping" : "none");
      const requestedFulfilment = cleanString(cart[i].physicalFulfilment).toLowerCase();
      const physicalFulfilment = configuredFulfilment === "shipping-or-pickup" &&
        ["shipping", "pickup"].includes(requestedFulfilment)
        ? requestedFulfilment
        : configuredFulfilment;
      const pickupLocation = physicalFulfilment === "pickup"
        ? await resolveSelectedPickupLocation(db, {
          productId: doc.id,
          variantId,
          referrerId,
          pickupLocationId: cart[i].pickupLocationId,
        })
        : null;

      if (physicalFulfilment === "pickup" && !pickupLocation) {
        throw new HttpsError(
          "failed-precondition",
          `Choose an available pickup location for ${name}.`,
        );
      }

      if (!price || isNaN(price)) throw new HttpsError("invalid-argument", `Invalid price for: ${name}`);

      return {
        id: doc.id,
        name,
        image,
        itemId: data.itemId || null,
        variantId: variantId || null,
        variantName: variantName || null,
        sku: variant?.sku || data.sku || null,
        accessType: accessGrants[0]?.accessEntityType || data.accessType || null,
        relatedPlanId: accessGrants.find((grant) => grant.accessEntityType === "Plan")?.accessEntityId ||
          data.relatedPlanId || null,
        relatedCourseId: data.relatedCourseId || null,
        relatedWorkshopId: data.relatedWorkshopId || null,
        physicalFulfilment,
        pickupLocation,
        requiresShipping: physicalFulfilment === "shipping",
        unlocksAccess: accessGrants.length > 0 || data.unlocksAccess === true,
        type: data.type || "item",
        productType: productDisplayType(data, "item"),
        accessGrants,
        price,
        quantity,
        creatorId: data.creatorId || null,
        stripeAccountId: creatorMap[data.creatorId] || null,
      };
    }));

    // 💳 Stripe line items
    const hasPhysicalItems = validatedItems.some((item) => item.requiresShipping);

    const lineItems = validatedItems.map((item) => ({
      price_data: {
        currency: "aud",
        unit_amount: Math.round(item.price * 100),
        product_data: {
          name: item.name,
          images: [item.image],
          metadata: {
            firebaseProductId: item.id,
            itemId: item.itemId || "",
            variantId: item.variantId || "",
            variantName: item.variantName || "",
            sku: item.sku || "",
            productType: item.productType || item.type || "item",
            accessType: item.accessType || "",
            relatedPlanId: item.relatedPlanId || "",
            relatedCourseId: item.relatedCourseId || "",
            relatedWorkshopId: item.relatedWorkshopId || "",
            requiresShipping: item.requiresShipping ? "true" : "false",
            physicalFulfilment: item.physicalFulfilment || "none",
            ...pickupLocationMetadata(item.pickupLocation),
            unlocksAccess: item.unlocksAccess ? "true" : "false",
          },
        },
      },
      quantity: item.quantity,
    }));

    const subtotal = validatedItems.reduce(
      (sum, item) => sum + Number(item.price) * Number(item.quantity),
      0,
    );
    const shipping = shippingQuote(shopSettings, subtotal, hasPhysicalItems);
    const shippingCost = shipping.costInCents;

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : {};

    let stripeCustomerId = userData.stripeCustomerId || null;

    const contact = {
      name: cleanString(customerInfo.name || userData.name),
      email: cleanEmail(customerInfo.email || userData.email || request.auth?.token?.email),
      phone: cleanString(customerInfo.phone || userData.phone),
    };

    const shippingAddress = normalizeShippingAddress(customerInfo);
    const billingAddress = customerInfo.billingAddress
      ? normalizeBillingAddress(customerInfo)
      : shippingAddress;

    if (hasPhysicalItems) {
      assertPhysicalCheckoutDetails({ contact, shippingAddress });
    }
  
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: contact.email,
        name: contact.name,
        phone: contact.phone,
        shipping: {
          name: contact.name,
          phone: contact.phone,
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
        email: contact.email,
        name: contact.name,
        phone: contact.phone,
        shipping: {
          name: contact.name,
          phone: contact.phone,
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
      ...(contact.name && { customer_name: contact.name }),
      ...(contact.email && { customer_email: contact.email }),
      ...(contact.phone && { customer_phone: contact.phone }),
      products: validatedItems.map((p) => `${p.type}:${p.name} x${p.quantity}`).join("; "),
    };

    const baseUrl = appBaseUrl();
    const sessionConfig = {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: `${baseUrl}/checkout?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cart`,
      metadata,

      customer: stripeCustomerId,

      phone_number_collection: {
        enabled: true,
      },

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

    if (collectShipping && hasPhysicalItems) {
      sessionConfig.shipping_address_collection = {
        allowed_countries: ["AU"],
      };
      sessionConfig.phone_number_collection = { enabled: true };
      sessionConfig.shipping_options = [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: shippingCost, currency: "aud" },
            display_name: shipping.label,
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
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          address: shippingAddress.line1 || "",
          billingAddress: billingAddress.line1 || "",
          defaultShippingAddress: shippingAddress,
          defaultBillingAddress: billingAddress,
          defaultShippingContact: contact,
          checkoutProfile: {
            ...customerInfo,
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
          },
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
    if (err instanceof HttpsError) {
      throw err;
    }

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
    secrets: [STRIPE_SECRET_KEY, STRIPE_SECRET_KEY_TEST, RECAPTCHA_SECRET_KEY],
  },
  createCheckoutSessionHandler,
);
