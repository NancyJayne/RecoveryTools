import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const stamp = () => admin.firestore.FieldValue.serverTimestamp();
const clean = (value, max = 500) => String(value || "").trim().slice(0, max);

function requireAdmin(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Only admins can manage user profiles.");
  }
}

function address(value = {}) {
  return {
    line1: clean(value.line1 || value.address_line1, 200),
    line2: clean(value.line2 || value.address_line2, 200),
    city: clean(value.city, 100),
    state: clean(value.state, 30).toUpperCase(),
    postcode: clean(value.postcode || value.postal_code, 20),
    country: clean(value.country || "AU", 2).toUpperCase(),
  };
}

function profileUpdate(data = {}, adminUid) {
  return {
    name: clean(data.name, 150),
    displayName: clean(data.name, 150),
    email: clean(data.email, 254).toLowerCase(),
    phone: clean(data.phone, 50),
    phoneNumber: clean(data.phone, 50),
    shippingAddress: address(data.shippingAddress),
    defaultShippingAddress: address(data.shippingAddress),
    billingAddress: address(data.billingAddress),
    defaultBillingAddress: address(data.billingAddress),
    businessName: clean(data.businessName, 200),
    businessAbn: clean(data.businessAbn, 30),
    businessWebsite: clean(data.businessWebsite, 300),
    businessEmail: clean(data.businessEmail, 254).toLowerCase(),
    businessPhone: clean(data.businessPhone, 50),
    businessAddress: clean(data.businessAddress, 500),
    updatedAt: stamp(),
    updatedByUid: adminUid,
  };
}

async function updateReferences(collectionName, fields, oldUid, primaryUid) {
  for (const field of fields) {
    const snapshot = await db.collection(collectionName).where(field, "==", oldUid).get();
    for (let index = 0; index < snapshot.docs.length; index += 400) {
      const batch = db.batch();
      snapshot.docs.slice(index, index + 400).forEach((record) => {
        batch.set(record.ref, {
          [field]: primaryUid,
          mergedFromUid: oldUid,
          profileMergedAt: stamp(),
        }, { merge: true });
      });
      await batch.commit();
    }
  }
}

async function copySubcollection(sourceUid, primaryUid, name) {
  const snapshot = await db.collection("users").doc(sourceUid).collection(name).get();
  for (let index = 0; index < snapshot.docs.length; index += 400) {
    const batch = db.batch();
    snapshot.docs.slice(index, index + 400).forEach((record) => {
      batch.set(
        db.collection("users").doc(primaryUid).collection(name).doc(record.id),
        { ...record.data(), mergedFromUid: sourceUid },
        { merge: true },
      );
    });
    await batch.commit();
  }
}

async function mergeProfiles(primaryUid, sourceUids, adminUid) {
  const primaryRef = db.collection("users").doc(primaryUid);
  const primarySnap = await primaryRef.get();
  if (!primarySnap.exists) throw new HttpsError("not-found", "Primary profile not found.");
  const primary = primarySnap.data();
  const mergedRoles = { ...(primary.roles || {}) };
  const mergedStripeIds = [primary.stripeCustomerId].filter(Boolean);

  const referenceMap = {
    orders: ["uid", "userId", "buyerUid", "firebaseUserId"],
    userAccess: ["userId"],
    customerAddresses: ["userId"],
    workshopTickets: ["uid", "userId", "buyerUid"],
    sharedCarts: ["userId"],
    reviews: ["userId"],
    referrals: ["userId", "referredBy", "referrerUid"],
    payouts: ["uid", "userId"],
  };

  for (const sourceUid of sourceUids) {
    if (!sourceUid || sourceUid === primaryUid) continue;
    const sourceRef = db.collection("users").doc(sourceUid);
    const sourceSnap = await sourceRef.get();
    if (!sourceSnap.exists) continue;
    const source = sourceSnap.data();
    Object.entries(source.roles || {}).forEach(([role, enabled]) => {
      if (enabled === true) mergedRoles[role] = true;
    });
    if (source.stripeCustomerId) mergedStripeIds.push(source.stripeCustomerId);
    for (const [collectionName, fields] of Object.entries(referenceMap)) {
      await updateReferences(collectionName, fields, sourceUid, primaryUid);
    }
    await Promise.all(["orders", "notes", "purchases"].map((name) => (
      copySubcollection(sourceUid, primaryUid, name)
    )));
    for (const roleCollection of ["affiliates", "therapists"]) {
      const roleRef = db.collection(roleCollection).doc(sourceUid);
      const roleSnap = await roleRef.get();
      if (roleSnap.exists) {
        await db.collection(roleCollection).doc(primaryUid).set({
          ...roleSnap.data(),
          uid: primaryUid,
          mergedFromUid: sourceUid,
          updatedAt: stamp(),
        }, { merge: true });
        await roleRef.set({
          status: "merged",
          active: false,
          mergedIntoUid: primaryUid,
          mergedAt: stamp(),
        }, { merge: true });
      }
    }
    await sourceRef.set({
      status: "merged",
      archived: true,
      active: false,
      mergedIntoUid: primaryUid,
      mergedAt: stamp(),
      mergedByUid: adminUid,
    }, { merge: true });
    try {
      await admin.auth().updateUser(sourceUid, { disabled: true });
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
  }

  const authUser = await admin.auth().getUser(primaryUid);
  await admin.auth().setCustomUserClaims(primaryUid, {
    ...(authUser.customClaims || {}),
    ...mergedRoles,
  });
  await primaryRef.set({
    roles: mergedRoles,
    mergedProfileUids: admin.firestore.FieldValue.arrayUnion(...sourceUids),
    stripeCustomerIds: [...new Set(mergedStripeIds)],
    updatedAt: stamp(),
    updatedByUid: adminUid,
  }, { merge: true });
}

export const manageUserProfiles = onCall(
  { region: "australia-southeast1", timeoutSeconds: 540 },
  async (request) => {
    requireAdmin(request);
    const { action, uid, uids = [], primaryUid, profile = {} } = request.data || {};
    if (action === "update") {
      if (!uid) throw new HttpsError("invalid-argument", "A user ID is required.");
      const update = profileUpdate(profile, request.auth.uid);
      if (profile.active === true) Object.assign(update, {
        active: true,
        archived: false,
        status: "active",
      });
      if (profile.roles && typeof profile.roles === "object") {
        update.roles = {
          admin: profile.roles.admin === true,
          affiliate: profile.roles.affiliate === true,
          therapist: profile.roles.therapist === true,
        };
      }
      await db.collection("users").doc(uid).set(update, { merge: true });
      for (const collectionName of ["affiliates", "therapists"]) {
        const ref = db.collection(collectionName).doc(uid);
        if ((await ref.get()).exists) await ref.set(update, { merge: true });
      }
      if (update.email) {
        const authUpdate = { email: update.email };
        if (update.name) authUpdate.displayName = update.name;
        if (update.phone.startsWith("+")) authUpdate.phoneNumber = update.phone;
        await admin.auth().updateUser(uid, authUpdate);
      }
      if (update.roles) {
        const authUser = await admin.auth().getUser(uid);
        await admin.auth().setCustomUserClaims(uid, {
          ...(authUser.customClaims || {}),
          ...update.roles,
        });
        for (const roleName of ["affiliate", "therapist"]) {
          if (!update.roles[roleName]) continue;
          await db.collection(`${roleName}s`).doc(uid).set({
            uid,
            email: update.email,
            name: update.name,
            businessName: update.businessName,
            abn: update.businessAbn,
            website: update.businessWebsite,
            businessEmail: update.businessEmail,
            businessPhone: update.businessPhone,
            businessAddress: update.businessAddress,
            status: "active",
            active: true,
            updatedAt: stamp(),
          }, { merge: true });
        }
      }
      return { success: true };
    }
    if (action === "archive") {
      const targets = [...new Set(uids)].filter(Boolean);
      if (!targets.length) throw new HttpsError("invalid-argument", "Select at least one user.");
      if (targets.includes(request.auth.uid)) {
        throw new HttpsError("failed-precondition", "You cannot archive your own active admin account.");
      }
      await Promise.all(targets.map(async (targetUid) => {
        await db.collection("users").doc(targetUid).set({
          status: "archived", archived: true, active: false,
          archivedAt: stamp(), archivedByUid: request.auth.uid,
        }, { merge: true });
        await admin.auth().updateUser(targetUid, { disabled: true });
      }));
      return { success: true, count: targets.length };
    }
    if (action === "merge") {
      const sources = [...new Set(uids)].filter((entry) => entry && entry !== primaryUid);
      if (!primaryUid || !sources.length) {
        throw new HttpsError("invalid-argument", "Choose one primary profile and at least one duplicate.");
      }
      if (sources.includes(request.auth.uid)) {
        throw new HttpsError("failed-precondition", "Your active admin account cannot be merged as a duplicate.");
      }
      await mergeProfiles(primaryUid, sources, request.auth.uid);
      return { success: true, primaryUid, mergedCount: sources.length };
    }
    throw new HttpsError("invalid-argument", "Unknown profile action.");
  },
);
