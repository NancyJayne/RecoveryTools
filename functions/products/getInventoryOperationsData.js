import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function status(value) {
  return clean(value || "active").toLowerCase();
}

function itemVariantInventoryId(itemId, itemVariantId) {
  return `INV-ITEMVARIANT-${itemId}-${itemVariantId}`
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .toUpperCase();
}

function dateMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemComponents(blueprint, blueprintVariantId = "") {
  const variants = Array.isArray(blueprint?.entityVariants) ? blueprint.entityVariants : [];
  const selected = variants.find((variant) =>
    clean(variant.entityVariantId) === clean(blueprintVariantId)) ||
    variants.find((variant) => variant.isDefault === true) ||
    variants[0];
  const components = selected?.linkedItemComponents || blueprint?.linkedItemComponents || [];
  return (Array.isArray(components) ? components : [])
    .map((component, index) => ({
      componentId: clean(component.componentId) || `COMPONENT-${index + 1}`,
      itemId: clean(component.itemId),
      itemVariantId: clean(component.itemVariantId),
      quantity: Number(component.quantity || 0),
      unit: clean(component.unit) || "each",
    }))
    .filter((component) => component.itemId && component.quantity > 0);
}

function blueprintVariant(blueprint, blueprintVariantId = "") {
  const variants = Array.isArray(blueprint?.entityVariants) ? blueprint.entityVariants : [];
  return variants.find((variant) =>
    clean(variant.entityVariantId) === clean(blueprintVariantId)) ||
    variants.find((variant) => variant.isDefault === true) ||
    variants[0] ||
    null;
}

export const getInventoryOperationsData = onCall(
  { region: "australia-southeast1" },
  async (request) => {
    if (request.auth?.token?.admin !== true) {
      throw new HttpsError("permission-denied", "Admin access required.");
    }
    const db = admin.firestore();
    const [
      inventorySnap,
      itemsSnap,
      productsSnap,
      variantsSnap,
      blueprintsSnap,
      productLinksSnap,
      variantLinksSnap,
      ordersSnap,
      orderItemsSnap,
      attendanceSnap,
      accessGrantsSnap,
      userAccessSnap,
      usersSnap,
      instructorsSnap,
    ] = await Promise.all([
      db.collection("inventory").get(),
      db.collection("items").get(),
      db.collection("products").get(),
      db.collection("productVariants").get(),
      db.collection("blueprints").get(),
      db.collection("productLinks").get(),
      db.collection("productVariantContentLinks").get(),
      db.collection("orders").get(),
      db.collection("orderItems").get(),
      db.collection("workshopAttendance").get(),
      db.collection("productAccessGrants").get(),
      db.collection("userAccess").get(),
      db.collection("users").get(),
      db.collection("instructors").get(),
    ]);

    const attendanceByBooking = new Map(attendanceSnap.docs.map((doc) => {
      const row = doc.data() || {};
      return [[clean(row.productId), clean(row.productVariantId), clean(row.orderId), clean(row.userId)].join(":"), row];
    }));
    const usersById = new Map(usersSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
    const instructorsById = new Map(instructorsSnap.docs.map((doc) => [
      doc.id,
      clean(doc.data()?.name) || doc.id,
    ]));
    const accessGrantsByProduct = new Map();
    accessGrantsSnap.docs.forEach((doc) => {
      const grant = { id: doc.id, ...doc.data() };
      if (status(grant.status) !== "active" || !clean(grant.productId)) return;
      const values = accessGrantsByProduct.get(clean(grant.productId)) || [];
      values.push(grant);
      accessGrantsByProduct.set(clean(grant.productId), values);
    });
    const activeUserAccess = userAccessSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((access) => access.active !== false && !access.revokedAt && status(access.status) !== "archived");

    const inventory = inventorySnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const inventoryByItem = new Map();
    inventory.filter((row) => clean(row.itemId)).forEach((row) => {
      const values = inventoryByItem.get(clean(row.itemId)) || [];
      values.push(row);
      inventoryByItem.set(clean(row.itemId), values);
    });
    const inventoryByProduct = new Map(inventory.filter((row) => clean(row.productId) && !clean(row.variantId))
      .map((row) => [clean(row.productId), row]));
    const inventoryByVariant = new Map(inventory.filter((row) => clean(row.variantId))
      .map((row) => [clean(row.variantId), row]));
    const items = new Map(itemsSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
    const blueprints = new Map(blueprintsSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
    const variantsByProduct = new Map();
    variantsSnap.docs.forEach((doc) => {
      const variant = { id: doc.id, ...doc.data() };
      const values = variantsByProduct.get(clean(variant.productId)) || [];
      values.push(variant);
      variantsByProduct.set(clean(variant.productId), values);
    });
    const manufacturingByProduct = new Map();
    productLinksSnap.docs.forEach((doc) => {
      const link = doc.data() || {};
      if (status(link.status) !== "active" || status(link.linkRole) !== "manufacturedfrom") return;
      manufacturingByProduct.set(clean(link.productId), {
        blueprintId: clean(link.linkedEntityId),
        blueprintVariantId: clean(link.entityVariantId),
      });
    });
    const manufacturingByVariant = new Map();
    variantLinksSnap.docs.forEach((doc) => {
      const link = doc.data() || {};
      if (status(link.status) !== "active" || status(link.linkRole) !== "manufacturedfrom") return;
      manufacturingByVariant.set(clean(link.productVariantId), {
        blueprintId: clean(link.entityId),
        blueprintVariantId: clean(link.entityVariantId),
      });
    });

    const stocktakeRows = [];
    items.forEach((item, itemId) => {
      const itemInventory = inventoryByItem.get(itemId) || [];
      const entityVariants = Array.isArray(item.entityVariants) ? item.entityVariants : [];
      const trackedVariants = entityVariants.filter((variant) =>
        variant?.behaviourDefaults?.inventoryTracked === true ||
        (
          variant?.behaviourDefaults?.inventoryTracked === undefined &&
          item.inventoryTracked === true
        ));
      if (trackedVariants.length) {
        trackedVariants.forEach((variant) => {
          const entityVariantId = clean(variant.entityVariantId);
          const row = itemInventory.find((entry) =>
            clean(entry.entityVariantId) === entityVariantId && !clean(entry.productId)) ||
            (trackedVariants.length === 1
              ? itemInventory.find((entry) => !clean(entry.variantId) && !clean(entry.entityVariantId))
              : null);
          const inventoryId = trackedVariants.length === 1 && row &&
              !clean(row.entityVariantId)
            ? row.inventoryId || row.id
            : itemVariantInventoryId(itemId, entityVariantId);
          const embeddedStockIsNewer = row &&
            dateMillis(variant.updatedAt || item.updatedAt) > dateMillis(row.updatedAt);
          stocktakeRows.push({
            inventoryId,
            entityType: "ItemVariant",
            entityId: itemId,
            itemVariantId: entityVariantId,
            name: item.name || item.title || itemId,
            variantName: variant.name || entityVariantId,
            stock: Number(
              embeddedStockIsNewer
                ? variant.stockQty ?? row?.stockQty ?? 0
                : row?.stockQty ?? variant.stockQty ?? 0,
            ),
            unit: item.inventoryUnit || row?.unit || "each",
            reorderLevel: Number(variant.reorderLevel ?? row?.reorderLevel ?? 0),
          });
        });
        return;
      }
      const row = itemInventory.find((entry) => !clean(entry.variantId) && !clean(entry.entityVariantId));
      if (item.inventoryTracked !== true) return;
      stocktakeRows.push({
        inventoryId: row?.inventoryId || row?.id || `INV-${itemId}`,
        entityType: "Item",
        entityId: itemId,
        name: item.name || item.title || itemId,
        variantName: "",
        stock: Number(row?.stockQty ?? item.stockQty ?? 0),
        unit: item.inventoryUnit || row?.unit || "each",
        reorderLevel: Number(item.reorderLevel ?? row?.reorderLevel ?? 0),
      });
    });

    const componentInventorySummary = (itemId) => {
      const rows = stocktakeRows.filter((row) =>
        row.entityId === itemId && ["Item", "ItemVariant"].includes(row.entityType));
      const variants = rows.filter((row) => row.entityType === "ItemVariant").map((row) => ({
        itemVariantId: row.itemVariantId,
        name: row.variantName,
        stock: row.stock,
        unit: row.unit,
      }));
      return {
        stock: rows.reduce((sum, row) => sum + Number(row.stock || 0), 0),
        variants,
      };
    };

    const productionOptions = [];
    const workshopSessions = [];
    const accessSummaries = [];
    const orderItemsByLine = new Map(orderItemsSnap.docs.map((doc) => {
      const row = doc.data() || {};
      return [`${clean(row.orderId)}:${Number(row.lineNumber || 0)}`, row];
    }));
    const allOrders = ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const countedOrders = allOrders
      .filter((order) => {
        const state = [order.status, order.orderStatus, order.paymentStatus, order.fulfilmentStatus]
          .map(status).join(" ");
        if (["cancel", "refund", "failed", "void"].some((value) => state.includes(value))) {
          return false;
        }
        return status(order.paymentStatus) === "paid" ||
          status(order.orderStatus) === "paid" || status(order.status) === "paid";
      });
    const attendeeHistoryOrders = allOrders.filter((order) => {
      const state = [
        order.status,
        order.orderStatus,
        order.paymentStatus,
        order.fulfilmentStatus,
        order.refundStatus,
      ].map(status).join(" ");
      if (["failed", "void"].some((value) => state.includes(value))) return false;
      return ["paid", "refund", "cancel"].some((value) => state.includes(value)) ||
        Number(order.amountPaid || order.totalPaid || 0) > 0 ||
        Boolean(order.stripePaymentIntentId || order.paymentIntentId);
    });
    productsSnap.docs.forEach((doc) => {
      const product = { id: doc.id, ...doc.data() };
      if (product.archived === true || status(product.shopStatus || product.status) === "archived") return;
      const productVariants = variantsByProduct.get(doc.id) || [];
      const purchased = countedOrders.reduce((total, order) => {
        const lines = Array.isArray(order.orderLines) && order.orderLines.length
          ? order.orderLines
          : Array.isArray(order.products) ? order.products : [];
        return total + lines.filter((line) => clean(line.productId) === doc.id)
          .reduce((sum, line) => sum + Math.max(Number(line.quantity || 1), 1), 0);
      }, 0);
      const accessTargets = (accessGrantsByProduct.get(doc.id) || []).map((grant) => ({
        type: clean(grant.accessEntityType || grant.accessType).toLowerCase(),
        id: clean(grant.accessEntityId || grant.accessId),
      })).filter((target) => target.id);
      const unlockedByUser = new Map();
      activeUserAccess.forEach((access) => {
        const accessId = clean(access.accessEntityId || access.accessId);
        const accessType = clean(access.accessEntityType || access.accessType).toLowerCase();
        if (!accessTargets.some((target) => target.id === accessId && (!target.type || target.type === accessType))) return;
        const userId = clean(access.userId || access.uid);
        if (!userId || unlockedByUser.has(userId)) return;
        const user = usersById.get(userId) || {};
        unlockedByUser.set(userId, {
          userId,
          name: clean(user.name || user.displayName) || clean(user.email) || userId,
          email: clean(user.email),
          accessId,
          accessType,
          grantedAt: access.grantedAt || access.createdAt || null,
        });
      });
      if (status(product.productType).includes("course") ||
          status(product.type).includes("course") || status(product.itemType).includes("course")) {
        accessSummaries.push({
          productId: doc.id,
          purchased,
          unlockedUsers: [...unlockedByUser.values()],
        });
      }
      const isWorkshop = product.tracksSeats === true;
      if (isWorkshop) {
        const sessionVariants = productVariants.length ? productVariants : [{
          id: "",
          variantName: "Default session",
          seatCapacity: product.seatCapacity,
          eventStartAt: product.eventStartAt,
          eventEndAt: product.eventEndAt,
          eventLocation: product.eventLocation,
          instructor: product.instructor,
        }];
        sessionVariants.forEach((variant) => {
          const attendees = [];
          attendeeHistoryOrders.forEach((order) => {
            const lines = Array.isArray(order.orderLines) && order.orderLines.length
              ? order.orderLines
              : Array.isArray(order.products) ? order.products : [];
            lines.forEach((line, index) => {
              const lineVariantId = clean(line.productVariantId || line.variantId);
              if (clean(line.productId) !== doc.id || lineVariantId !== clean(variant.id)) return;
              const storedLine = orderItemsByLine.get(
                `${order.id}:${Number(line.lineNumber || index + 1)}`,
              );
              const removalState = status(
                storedLine?.refundStatus || line.refundStatus || order.refundStatus || order.paymentStatus,
              );
              const removed = ["refunded", "cancelled", "canceled"].includes(removalState) ||
                ["cancelled", "canceled"].includes(status(order.fulfilmentStatus));
              attendees.push({
                orderId: order.id,
                userId: clean(order.userId || order.buyerUid),
                name: clean(order.customerName || order.userName) || "Customer",
                email: clean(order.customerEmail || order.userEmail),
                phone: clean(order.customerPhone),
                quantity: Math.max(Number(line.quantity || 1), 1),
                status: removed ? "removed" : "active",
                removed,
                removalReason: removed
                  ? clean(
                    order.refundReason ||
                    storedLine?.refundReason ||
                    order.customerFollowUpResolution ||
                    order.customerFollowUpNotes,
                  ) || "Workshop booking cancelled"
                  : "",
                removedAt: order.refundedAt || order.refundRequestedAt || order.updatedAt || null,
                purchasedAt: order.purchasedAt || order.createdAt || order.orderDate || null,
                checkedIn: attendanceByBooking.get([
                  doc.id,
                  clean(variant.id),
                  order.id,
                  clean(order.userId || order.buyerUid),
                ].join(":"))?.checkedIn === true,
              });
            });
          });
          const capacity = Number(variant.seatCapacity ?? product.seatCapacity ?? 0);
          const sold = attendees
            .filter((attendee) => !attendee.removed)
            .reduce((sum, attendee) => sum + attendee.quantity, 0);
          workshopSessions.push({
            productId: doc.id,
            productName: product.productName || product.name || doc.id,
            productVariantId: clean(variant.id),
            variantName: variant.variantName || variant.name || "Default session",
            status: status(variant.status || product.shopStatus || "draft"),
            capacity,
            nearCapacityWarning: Number(variant.nearCapacityWarning || 0) || null,
            sold,
            remaining: capacity > 0 ? Math.max(capacity - sold, 0) : null,
            eventStartAt: variant.eventStartAt || product.eventStartAt || "",
            eventEndAt: variant.eventEndAt || product.eventEndAt || "",
            eventLocation: variant.eventLocation || product.eventLocation || "",
            instructor: instructorsById.get(clean(
              variant.instructorId || variant.instructor || product.instructorId || product.instructor,
            )) || variant.instructor || product.instructor || "",
            attendees,
          });
        });
      }
      if (productVariants.length) {
        productVariants.forEach((variant) => {
          const inventoryRow = inventoryByVariant.get(variant.id);
          if (variant.inventoryTracked === true || product.inventoryTracked === true) {
            stocktakeRows.push({
              inventoryId: inventoryRow?.inventoryId || inventoryRow?.id || `INV-${variant.id}`,
              entityType: "ProductVariant",
              entityId: variant.id,
              productId: doc.id,
              name: product.productName || product.name || doc.id,
              variantName: variant.variantName || variant.name || variant.id,
              stock: Number(inventoryRow?.stockQty ?? variant.stockQuantity ?? 0),
              unit: inventoryRow?.unit || "each",
              reorderLevel: Number(variant.reorderLevel ?? inventoryRow?.reorderLevel ?? 0),
            });
          }
          const recipeLink = manufacturingByVariant.get(variant.id) ||
            manufacturingByProduct.get(doc.id) ||
            (clean(product.manufacturingBlueprintId)
              ? { blueprintId: clean(product.manufacturingBlueprintId), blueprintVariantId: "" }
              : null);
          const blueprint = recipeLink ? blueprints.get(recipeLink.blueprintId) : null;
          const selectedBlueprintVariantId = recipeLink?.blueprintVariantId || variant.contentVariantId;
          const selectedBlueprintVariant = blueprintVariant(blueprint, selectedBlueprintVariantId);
          const components = itemComponents(blueprint, selectedBlueprintVariantId);
          if (blueprint && components.length) {
            productionOptions.push({
              productId: doc.id,
              productVariantId: variant.id,
              productName: product.productName || product.name || doc.id,
              variantName: variant.variantName || variant.name || variant.id,
              blueprintId: blueprint.id,
              blueprintName: blueprint.name || blueprint.title || blueprint.id,
              blueprintVariantId: clean(selectedBlueprintVariant?.entityVariantId),
              blueprintVariantName: selectedBlueprintVariant?.name || "",
              blueprintVariantCount: Array.isArray(blueprint.entityVariants)
                ? blueprint.entityVariants.length
                : 0,
              components: components.map((component) => {
                const summary = componentInventorySummary(component.itemId);
                return {
                  ...component,
                  name: items.get(component.itemId)?.name ||
                    items.get(component.itemId)?.title || component.itemId,
                  stock: summary.stock,
                  variants: summary.variants,
                };
              }),
            });
          }
        });
      } else {
        const inventoryRow = inventoryByProduct.get(doc.id);
        if (product.inventoryTracked === true) {
          stocktakeRows.push({
            inventoryId: inventoryRow?.inventoryId || inventoryRow?.id || `INV-${doc.id}`,
            entityType: "Product",
            entityId: doc.id,
            productId: doc.id,
            name: product.productName || product.name || doc.id,
            variantName: "",
            stock: Number(inventoryRow?.stockQty ?? product.stock ?? 0),
            unit: inventoryRow?.unit || "each",
            reorderLevel: Number(inventoryRow?.reorderLevel ?? 0),
          });
        }
        const recipeLink = manufacturingByProduct.get(doc.id) ||
          (clean(product.manufacturingBlueprintId)
            ? { blueprintId: clean(product.manufacturingBlueprintId), blueprintVariantId: "" }
            : null);
        const blueprint = recipeLink ? blueprints.get(recipeLink.blueprintId) : null;
        const selectedBlueprintVariant = blueprintVariant(blueprint, recipeLink?.blueprintVariantId);
        const components = itemComponents(blueprint, recipeLink?.blueprintVariantId);
        if (blueprint && components.length) {
          productionOptions.push({
            productId: doc.id,
            productVariantId: "",
            productName: product.productName || product.name || doc.id,
            variantName: "",
            blueprintId: blueprint.id,
            blueprintName: blueprint.name || blueprint.title || blueprint.id,
            blueprintVariantId: clean(selectedBlueprintVariant?.entityVariantId),
            blueprintVariantName: selectedBlueprintVariant?.name || "",
            blueprintVariantCount: Array.isArray(blueprint.entityVariants)
              ? blueprint.entityVariants.length
              : 0,
            components: components.map((component) => {
              const summary = componentInventorySummary(component.itemId);
              return {
                ...component,
                name: items.get(component.itemId)?.name ||
                  items.get(component.itemId)?.title || component.itemId,
                stock: summary.stock,
                variants: summary.variants,
              };
            }),
          });
        }
      }
    });

    return {
      stocktakeRows: stocktakeRows.sort((a, b) =>
        `${a.name} ${a.variantName}`.localeCompare(`${b.name} ${b.variantName}`)),
      productionOptions,
      workshopSessions: workshopSessions.sort((a, b) =>
        `${a.eventStartAt} ${a.productName} ${a.variantName}`
          .localeCompare(`${b.eventStartAt} ${b.productName} ${b.variantName}`)),
      accessSummaries,
    };
  },
);
