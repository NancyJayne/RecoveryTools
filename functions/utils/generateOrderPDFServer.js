import admin from "firebase-admin";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { randomUUID } from "crypto";
import { getStorage } from "firebase-admin/storage";
import { businessAddressLines, getBusinessProfile } from "./businessProfile.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

function invoiceBucket() {
  return getStorage().bucket();
}

function currency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatInvoiceDate(value) {
  if (!value) return "N/A";
  const date = typeof value.toDate === "function" ? value.toDate() : value;
  if (date instanceof Date) return date.toLocaleDateString("en-AU");
  if (typeof value === "number") return new Date(value).toLocaleDateString("en-AU");
  if (typeof value === "string") {
    const parsedDate = new Date(value);
    return Number.isNaN(parsedDate.getTime()) ? value : parsedDate.toLocaleDateString("en-AU");
  }
  return "N/A";
}

function firebaseStorageUrl(bucketName, fileName, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(fileName)}?alt=media&token=${encodeURIComponent(token)}`;
}

function emulatorStorageUrl(bucketName, fileName, token) {
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199";
  const normalizedHost = host.startsWith("http") ? host : `http://${host}`;
  return [
    `${normalizedHost}/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(fileName)}`,
    `?alt=media&token=${encodeURIComponent(token)}`,
  ].join("");
}

function customerName(orderData) {
  return orderData.customerName || orderData.shippingName || orderData.userName || "Customer";
}

function customerEmail(orderData) {
  return orderData.customerEmail || orderData.shippingEmail || orderData.userEmail || orderData.email || "N/A";
}

function customerPhone(orderData) {
  return orderData.customerPhone || orderData.shippingPhone || orderData.phone || "N/A";
}

function addressLines(address = {}) {
  if (!address || typeof address !== "object") return ["N/A"];
  return [
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code || address.postcode].filter(Boolean).join(" "),
    address.country,
  ].filter(Boolean);
}

function products(orderData) {
  if (Array.isArray(orderData.orderLines) && orderData.orderLines.length) return orderData.orderLines;
  if (Array.isArray(orderData.products)) return orderData.products;
  if (Array.isArray(orderData.items)) return orderData.items;
  return [];
}

function productName(product) {
  return product.productName || product.name || product.productTitle || product.title || product.description || "Item";
}

function productQuantity(product) {
  const quantity = Number(product.quantity || 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function productUnitPrice(product) {
  if (product.unitPrice !== undefined) return Number(product.unitPrice || 0);
  if (product.price !== undefined) return Number(product.price || 0);
  const quantity = productQuantity(product);
  return Number(product.lineTotal || 0) / quantity;
}

function productLineTotal(product) {
  if (product.lineTotal !== undefined) return Number(product.lineTotal || 0);
  return productUnitPrice(product) * productQuantity(product);
}

function shippingAmount(orderData) {
  if (typeof orderData.shipping === "number") return orderData.shipping;
  return Number(orderData.shippingAmount ?? orderData.shipping?.amount_total ?? 0);
}

function amountPaid(orderData) {
  if (orderData.amountPaid !== undefined) return Number(orderData.amountPaid || 0);
  if (orderData.totalPaid !== undefined) return Number(orderData.totalPaid || 0);
  const status = String(orderData.status || orderData.orderStatus || "").toLowerCase();
  return status.includes("paid") ? Number(orderData.total || 0) : 0;
}

async function loadLogoBuffer(logoUrl) {
  if (!logoUrl) return null;
  try {
    const response = await fetch(logoUrl);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.warn("Invoice logo could not be loaded. Rendering text header only.", err);
    return null;
  }
}

function drawAddressBlock(pdfDoc, title, lines, x, y, width) {
  pdfDoc.fontSize(9).fillColor("#4b5563").text(title, x, y, { width });
  pdfDoc.moveDown(0.25);
  pdfDoc.fontSize(10).fillColor("#111827");
  lines.forEach((line) => {
    pdfDoc.text(line || "N/A", x, pdfDoc.y, { width });
  });
}

function drawInvoiceMeta(pdfDoc, { invoiceId, invoiceDate, right }) {
  pdfDoc.fontSize(18).fillColor("#111827").text("Tax Invoice", right - 180, 48, {
    width: 180,
    align: "right",
  });

  pdfDoc.fontSize(9).fillColor("#4b5563").text("Date", right - 270, 82, {
    width: 80,
    align: "right",
  });
  pdfDoc.fontSize(10).fillColor("#111827").text(invoiceDate, right - 180, 82, {
    width: 180,
    align: "right",
  });

  pdfDoc.fontSize(9).fillColor("#4b5563").text("Invoice", right - 300, 108, {
    width: 300,
    align: "right",
  });
  pdfDoc.fontSize(8).fillColor("#111827").text(invoiceId, right - 300, 124, {
    width: 300,
    align: "right",
  });
}

function drawTotalsRow(pdfDoc, label, value, x, y, isBold = false) {
  pdfDoc
    .font(isBold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(isBold ? 11 : 10)
    .fillColor("#111827")
    .text(label, x, y, { width: 120 })
    .text(value, x + 130, y, { width: 100, align: "right" })
    .font("Helvetica");
}

export async function generateOrderPDF(invoiceId, orderData) {
  const business = await getBusinessProfile();
  const businessAddress = businessAddressLines(business);
  const fileName = `invoices/${invoiceId}.pdf`;
  const pdfStream = new PassThrough();
  const pdfDoc = new PDFDocument({ margin: 48, size: "A4" });
  pdfDoc.pipe(pdfStream);

  const logoBuffer = await loadLogoBuffer(business.logoUrl);
  const pageWidth = pdfDoc.page.width - pdfDoc.page.margins.left - pdfDoc.page.margins.right;
  const left = pdfDoc.page.margins.left;
  const right = left + pageWidth;
  const invoiceDate = formatInvoiceDate(orderData.purchasedAt || orderData.createdAt);
  const orderProducts = products(orderData);
  const subtotal = Number(
    orderData.subtotal ??
    orderProducts.reduce((sum, item) => sum + productLineTotal(item), 0),
  );
  const shipping = shippingAmount(orderData);
  const total = Number(orderData.total || subtotal + shipping);
  const gst = Number(orderData.gst ?? orderData.gstAmount ?? total / 11);
  const paid = amountPaid(orderData);
  const outstanding = Math.max(total - paid, 0);
  const tableColumns = {
    item: { x: left + 8, width: 260 },
    qty: { x: left + 288, width: 35 },
    unit: { x: left + 342, width: 68 },
    lineTotal: { x: left + 420, width: 70 },
  };

  if (logoBuffer) {
    pdfDoc.image(logoBuffer, left, 42, { width: 48, height: 48, fit: [48, 48] });
  }

  pdfDoc.fontSize(20).fillColor("#111827").text(business.name, left + 60, 46, {
    width: 260,
  });
  pdfDoc
    .fontSize(10)
    .fillColor("#4b5563")
    .text(`ABN: ${business.abn}`, left + 60, 72)
    .text(businessAddress[0] || "", left + 60, 86, { width: 240 })
    .text(businessAddress[1] || "", left + 60, 100, { width: 240 })
    .text(businessAddress[2] || "", left + 60, 114, { width: 240 })
    .text(business.email, left + 60, 128)
    .text(business.phone || "", left + 60, 142);

  drawInvoiceMeta(pdfDoc, { invoiceId, invoiceDate, right });

  pdfDoc.moveTo(left, 168).lineTo(right, 168).strokeColor("#d1d5db").stroke();

  const detailsTop = 190;
  drawAddressBlock(
    pdfDoc,
    "Customer",
    [customerName(orderData), customerEmail(orderData), customerPhone(orderData)],
    left,
    detailsTop,
    150,
  );
  drawAddressBlock(
    pdfDoc,
    "Shipping address",
    addressLines(orderData.shippingAddress || orderData.shipping?.address),
    left + 180,
    detailsTop,
    160,
  );
  drawAddressBlock(
    pdfDoc,
    "Billing address",
    addressLines(orderData.billingAddress),
    left + 360,
    detailsTop,
    160,
  );

  let tableY = Math.max(pdfDoc.y + 24, 300);
  pdfDoc.rect(left, tableY, pageWidth, 24).fillColor("#e5f2ef").fill();
  pdfDoc
    .fontSize(9)
    .fillColor("#111827")
    .text("Item", tableColumns.item.x, tableY + 8, { width: tableColumns.item.width })
    .text("Qty", tableColumns.qty.x, tableY + 8, { width: tableColumns.qty.width, align: "right" })
    .text("Unit", tableColumns.unit.x, tableY + 8, { width: tableColumns.unit.width, align: "right" })
    .text("Line total", tableColumns.lineTotal.x, tableY + 8, {
      width: tableColumns.lineTotal.width,
      align: "right",
    });
  tableY += 30;

  orderProducts.forEach((item) => {
    const y = tableY;
    pdfDoc
      .fontSize(10)
      .fillColor("#111827")
      .text(productName(item), tableColumns.item.x, y, { width: tableColumns.item.width })
      .text(String(productQuantity(item)), tableColumns.qty.x, y, {
        width: tableColumns.qty.width,
        align: "right",
      })
      .text(currency(productUnitPrice(item)), tableColumns.unit.x, y, {
        width: tableColumns.unit.width,
        align: "right",
      })
      .text(currency(productLineTotal(item)), tableColumns.lineTotal.x, y, {
        width: tableColumns.lineTotal.width,
        align: "right",
      });
    tableY = Math.max(pdfDoc.y, y + 18) + 8;
  });

  if (!orderProducts.length) {
    pdfDoc.fontSize(10).fillColor("#111827").text("No line items found.", left + 8, tableY);
    tableY += 24;
  }

  pdfDoc.moveTo(left, tableY).lineTo(right, tableY).strokeColor("#d1d5db").stroke();
  tableY += 14;

  const totalsX = right - 230;
  [
    ["Subtotal", currency(subtotal), false, 18],
    ["Shipping", currency(shipping), false, 18],
    ["GST included", currency(gst), false, 22],
    ["Total", currency(total), true, 18],
    ["Total paid", currency(paid), false, 18],
    ["Outstanding amount", currency(outstanding), true, 18],
  ].forEach(([label, value, isBold, rowHeight]) => {
    drawTotalsRow(pdfDoc, label, value, totalsX, tableY, isBold);
    tableY += rowHeight;
  });

  pdfDoc
    .fontSize(11)
    .fillColor("#111827")
    .text("Thank you for your purchase.", left, Math.max(tableY + 34, 650), {
      align: "center",
      width: pageWidth,
    });
  pdfDoc.fontSize(9).fillColor("#4b5563").text("Please keep this invoice for your records.", left, pdfDoc.y + 6, {
    align: "center",
    width: pageWidth,
  });

  pdfDoc.end();

  const bucket = invoiceBucket();
  const file = bucket.file(fileName);
  const downloadToken = randomUUID();
  const uploadStream = file.createWriteStream({
    contentType: "application/pdf",
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });
  pdfStream.pipe(uploadStream);

  await new Promise((resolve, reject) => {
    uploadStream.on("finish", resolve);
    uploadStream.on("error", reject);
  });

  if (process.env.FUNCTIONS_EMULATOR === "true") {
    return emulatorStorageUrl(bucket.name, fileName, downloadToken);
  }

  return firebaseStorageUrl(bucket.name, fileName, downloadToken);
}

function packingReference(item) {
  const variant = item.variantName || item.productVariantName ||
    item.productVariantId || item.variantId || "";
  return [
    variant ? `Variant: ${variant}` : "",
    item.sku ? `SKU: ${item.sku}` : "",
  ].filter(Boolean).join(" | ") || "-";
}

export async function generatePackingSlipPDF(invoiceId, orderData, overrides = {}) {
  const business = await getBusinessProfile();
  const fileName = `packing-slips/${invoiceId}.pdf`;
  const pdfStream = new PassThrough();
  const pdfDoc = new PDFDocument({ margin: 48, size: "A4" });
  pdfDoc.pipe(pdfStream);

  const logoBuffer = await loadLogoBuffer(business.logoUrl);
  const left = pdfDoc.page.margins.left;
  const width = pdfDoc.page.width - left - pdfDoc.page.margins.right;
  const right = left + width;
  const orderProducts = products(orderData);
  const shippingLines = addressLines(orderData.shippingAddress || orderData.shipping?.address);
  const dueDate = overrides.dueDate || orderData.dueDate || "Not set";
  const notes = overrides.notes || orderData.adminNotes || orderData.note || "No packing notes";

  if (logoBuffer) {
    pdfDoc.image(logoBuffer, left, 42, { width: 48, height: 48, fit: [48, 48] });
  }
  pdfDoc.fontSize(20).fillColor("#111827").text(business.name, left + 60, 48, { width: 280 });
  pdfDoc.fontSize(18).text("Packing slip", right - 180, 48, { width: 180, align: "right" });
  pdfDoc.fontSize(9).fillColor("#4b5563").text(`Order ${invoiceId}`, right - 280, 78, {
    width: 280,
    align: "right",
  });
  pdfDoc.moveTo(left, 112).lineTo(right, 112).strokeColor("#d1d5db").stroke();

  pdfDoc.fontSize(10).fillColor("#111827").text(`Order placed: ${formatInvoiceDate(
    orderData.purchasedAt || orderData.orderDate || orderData.createdAt,
  )}`, left, 132);
  pdfDoc.text(`Due date: ${dueDate}`, left, 150);

  drawAddressBlock(
    pdfDoc,
    "Recipient",
    [customerName(orderData), ...shippingLines, customerPhone(orderData), customerEmail(orderData)],
    left,
    184,
    width,
  );

  let tableY = Math.max(pdfDoc.y + 24, 300);
  pdfDoc.rect(left, tableY, width, 24).fillColor("#e5f2ef").fill();
  pdfDoc.fontSize(9).fillColor("#111827")
    .text("Item", left + 8, tableY + 8, { width: 220 })
    .text("Variant / SKU", left + 238, tableY + 8, { width: 210 })
    .text("Qty", right - 44, tableY + 8, { width: 36, align: "right" });
  tableY += 32;

  orderProducts.forEach((item) => {
    const rowHeight = Math.max(
      pdfDoc.heightOfString(productName(item), { width: 220 }),
      pdfDoc.heightOfString(packingReference(item), { width: 210 }),
      14,
    ) + 12;
    pdfDoc.fontSize(10).fillColor("#111827")
      .text(productName(item), left + 8, tableY, { width: 220 })
      .text(packingReference(item), left + 238, tableY, { width: 210 })
      .text(String(productQuantity(item)), right - 44, tableY, { width: 36, align: "right" });
    tableY += rowHeight;
    pdfDoc.moveTo(left, tableY - 5).lineTo(right, tableY - 5).strokeColor("#e5e7eb").stroke();
  });

  if (!orderProducts.length) {
    pdfDoc.fontSize(10).text("No line items found.", left + 8, tableY);
    tableY += 28;
  }

  pdfDoc.fontSize(11).fillColor("#111827").text("Packing notes", left, tableY + 20);
  pdfDoc.rect(left, tableY + 40, width, 80).strokeColor("#d1d5db").stroke();
  pdfDoc.fontSize(10).text(String(notes), left + 10, tableY + 50, { width: width - 20, height: 60 });
  pdfDoc.end();

  const bucket = invoiceBucket();
  const file = bucket.file(fileName);
  const downloadToken = randomUUID();
  const uploadStream = file.createWriteStream({
    contentType: "application/pdf",
    metadata: {
      contentDisposition: `inline; filename="packing-slip-${invoiceId}.pdf"`,
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });
  pdfStream.pipe(uploadStream);
  await new Promise((resolve, reject) => {
    uploadStream.on("finish", resolve);
    uploadStream.on("error", reject);
  });

  if (process.env.FUNCTIONS_EMULATOR === "true") {
    return emulatorStorageUrl(bucket.name, fileName, downloadToken);
  }
  return firebaseStorageUrl(bucket.name, fileName, downloadToken);
}
