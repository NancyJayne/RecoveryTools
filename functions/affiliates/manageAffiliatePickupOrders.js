import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import { getBusinessProfile } from "../utils/businessProfile.js";
import { logEmailEvent } from "../utils/emailLog.js";

if (!admin.apps.length) admin.initializeApp();
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
const stamp = () => admin.firestore.FieldValue.serverTimestamp();
const escapeHtml = (value) => clean(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

function customerEmail(order) {
  return clean(order.customerEmail || order.shippingEmail || order.userEmail || order.email);
}

function customerName(order) {
  return clean(order.customerName || order.shippingName || order.userName) || "Customer";
}

async function sendReadyForPickupEmail({ orderId, order, affiliate }) {
  const to = customerEmail(order);
  if (!to) return { sent: false, error: "Order has no customer email." };
  const business = await getBusinessProfile();
  const pickup = pickupItems(order)[0]?.pickupLocation || {};
  const pickupName = clean(
    pickup.businessName || pickup.locationName || affiliate.businessName || affiliate.name,
  );
  const subject = `Your ${business.name} order ${orderId} is ready for pickup`;
  const sandboxed = process.env.FUNCTIONS_EMULATOR === "true";
  const pickupInstructions = clean(pickup.customerInstructions)
    ? `<p><strong>Pickup instructions:</strong> ${escapeHtml(pickup.customerInstructions)}</p>`
    : "";
  const message = {
    to,
    from: business.email,
    subject,
    html: `
      <p>Hi ${escapeHtml(customerName(order))},</p>
      <p>Your order is ready for pickup from <strong>${escapeHtml(pickupName)}</strong>.</p>
      <p><strong>Pickup address:</strong> ${escapeHtml(pickup.address)}</p>
      ${pickupInstructions}
      <p>Please take your order confirmation with you when collecting your order.</p>
      <p>If you have any questions, contact us at
        <a href="mailto:${escapeHtml(business.email)}">${escapeHtml(business.email)}</a>.</p>
      <p>- ${escapeHtml(business.name)} Team</p>
    `,
    mailSettings: { sandboxMode: { enable: sandboxed } },
  };
  if (!sandboxed) {
    sgMail.setApiKey(SENDGRID_API_KEY.value());
    await sgMail.send(message);
  }
  await logEmailEvent({
    type: "pickup_ready",
    status: sandboxed ? "sandboxed" : "sent",
    to,
    subject,
    orderId,
    userId: clean(order.uid || order.userId),
    providerMode: sandboxed ? "sandbox" : "live",
    sentByUid: clean(affiliate.userId || affiliate.uid),
    metadata: { affiliateId: affiliate.id, pickupName },
  });
  return { sent: !sandboxed, sandboxed };
}

async function affiliateProfile(db, uid) {
  const direct = await db.collection("affiliates").doc(uid).get();
  if (direct.exists) return { id: direct.id, ...direct.data() };
  const match = await db.collection("affiliates").where("userId", "==", uid).limit(1).get();
  return match.empty ? null : { id: match.docs[0].id, ...match.docs[0].data() };
}

function pickupItems(order = {}) {
  const items = Array.isArray(order.items)
    ? order.items
    : (Array.isArray(order.products) ? order.products : []);
  return items.filter((item) =>
    lower(item.physicalFulfilment) === "pickup" &&
    lower(item.pickupLocation?.sourceType) === "affiliate");
}

export const manageAffiliatePickupOrders = onCall(
  { region: "australia-southeast1", secrets: [SENDGRID_API_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid || request.auth?.token?.affiliate !== true) {
      throw new HttpsError("permission-denied", "Affiliate access required.");
    }
    const db = admin.firestore();
    const affiliate = await affiliateProfile(db, uid);
    if (!affiliate) throw new HttpsError("not-found", "Affiliate profile not found.");
    const action = lower(request.data?.action || "list");

    if (action === "list") {
      const referrers = [...new Set([affiliate.id, uid])];
      const snapshots = await Promise.all(referrers.map((referrerId) =>
        db.collection("orders").where("referredBy", "==", referrerId).limit(100).get()));
      const orders = [...new Map(snapshots.flatMap((snapshot) => snapshot.docs)
        .map((entry) => [entry.id, { id: entry.id, ...entry.data() }])).values()]
        .filter((order) => pickupItems(order).length)
        .map((order) => ({
          id: order.id,
          invoiceId: order.invoiceId || order.invoiceNumber || order.id,
          customerName: order.customerName || order.userName || order.shippingName || "Customer",
          fulfilmentStatus: lower(order.fulfilmentStatus || order.status || "new"),
          trackingNumber: clean(order.trackingNumber || order.tracking),
          shippingCarrier: clean(order.shippingCarrier),
          items: pickupItems(order).map((item) => ({
            name: clean(item.name || item.productName),
            variantName: clean(item.variantName),
            quantity: Number(item.quantity || 1),
          })),
        }));
      return { orders };
    }

    if (action !== "ready") {
      throw new HttpsError("invalid-argument", "Unknown pickup-order action.");
    }
    const orderId = clean(request.data?.orderId);
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found.");
    const order = orderSnap.data() || {};
    if (![affiliate.id, uid].includes(clean(order.referredBy)) || !pickupItems(order).length) {
      throw new HttpsError("permission-denied", "This pickup order is not assigned to you.");
    }
    const currentStatus = lower(order.fulfilmentStatus || order.status);
    if (!["shipped_to_affiliate", "ready_for_pickup"].includes(currentStatus)) {
      throw new HttpsError(
        "failed-precondition",
        "Admin must dispatch this order to you before it can be marked ready.",
      );
    }
    const readyUpdate = {
      fulfilmentStatus: "ready_for_pickup",
      status: "Ready For Pickup",
      orderStatus: "ready for pickup",
      affiliateReceivedAt: stamp(),
      readyForPickupAt: stamp(),
      readyForPickupByUid: uid,
      updatedAt: stamp(),
      timeline: admin.firestore.FieldValue.arrayUnion({
        type: "affiliate_pickup_ready",
        label: "Affiliate confirmed order received and ready for customer pickup",
        at: admin.firestore.Timestamp.now(),
        byUid: uid,
        byName: clean(affiliate.businessName || affiliate.name || affiliate.email),
      }),
    };
    await orderRef.set(readyUpdate, { merge: true });
    let email = { sent: false };
    try {
      email = await sendReadyForPickupEmail({ orderId, order, affiliate });
      await orderRef.set({
        readyForPickupEmailSentAt: email.sent ? stamp() : null,
        readyForPickupEmailSandboxedAt: email.sandboxed ? stamp() : null,
      }, { merge: true });
    } catch (error) {
      console.error("Ready-for-pickup email failed:", error);
      await logEmailEvent({
        type: "pickup_ready",
        status: "failed",
        to: customerEmail(order),
        subject: `Order ${orderId} ready for pickup`,
        orderId,
        errorMessage: error.message,
        sentByUid: uid,
      });
      email = { sent: false, error: error.message };
    }
    return { success: true, fulfilmentStatus: "ready_for_pickup", email };
  },
);
