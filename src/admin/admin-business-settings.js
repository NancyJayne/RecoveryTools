import { httpsCallable } from "firebase/functions";
import { functions, storage } from "../utils/firebase-config.js";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { showToast } from "../utils/utils.js";

const FIELD_IDS = [
  "businessName",
  "businessAbn",
  "businessAddress",
  "businessPhone",
  "businessEmail",
  "businessLogoItemId",
  "businessLogoUrl",
  "businessFaviconItemId",
  "businessFaviconUrl",
  "businessSeoTitle",
  "businessSeoDescription",
  "businessAboutTitle",
  "businessAboutDescription",
  "businessAboutImageUrl",
  "businessTermsItemId",
  "businessTermsPdfUrl",
  "businessPrivacyItemId",
  "businessPrivacyPdfUrl",
  "businessSupportItemId",
  "businessSupportPdfUrl",
  "businessCommerceItemId",
  "businessCommercePdfUrl",
];

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setFormValues(business) {
  document.getElementById("businessName").value = business.name || "";
  document.getElementById("businessAbn").value = business.abn || "";
  document.getElementById("businessAddress").value = business.address || "";
  document.getElementById("businessPhone").value = business.phone || "";
  document.getElementById("businessEmail").value = business.email || "";
  document.getElementById("businessLogoItemId").value = business.logoItemId || "";
  document.getElementById("businessLogoUrl").value = business.logoUrl || "";
  document.getElementById("businessFaviconItemId").value = business.faviconItemId || "";
  document.getElementById("businessFaviconUrl").value = business.faviconUrl || "";
  document.getElementById("businessSeoTitle").value = business.seoTitle || "";
  document.getElementById("businessSeoDescription").value = business.seoDescription || "";
  document.getElementById("businessAboutTitle").value = business.aboutTitle || "";
  document.getElementById("businessAboutDescription").value = business.aboutDescription || "";
  document.getElementById("businessAboutImageUrl").value = business.aboutImageUrl || "";
  document.getElementById("businessTermsItemId").value = business.termsItemId || "";
  document.getElementById("businessTermsPdfUrl").value = business.termsPdfUrl || "";
  document.getElementById("businessPrivacyItemId").value = business.privacyItemId || "";
  document.getElementById("businessPrivacyPdfUrl").value = business.privacyPdfUrl || "";
  document.getElementById("businessSupportItemId").value = business.supportItemId || "";
  document.getElementById("businessSupportPdfUrl").value = business.supportPdfUrl || "";
  document.getElementById("businessCommerceItemId").value = business.commerceItemId || "";
  document.getElementById("businessCommercePdfUrl").value = business.commercePdfUrl || "";
}

function formData() {
  return {
    name: document.getElementById("businessName")?.value.trim(),
    abn: document.getElementById("businessAbn")?.value.trim(),
    address: document.getElementById("businessAddress")?.value.trim(),
    phone: document.getElementById("businessPhone")?.value.trim(),
    email: document.getElementById("businessEmail")?.value.trim(),
    logoItemId: document.getElementById("businessLogoItemId")?.value.trim(),
    logoUrl: document.getElementById("businessLogoUrl")?.value.trim(),
    faviconItemId: document.getElementById("businessFaviconItemId")?.value.trim(),
    faviconUrl: document.getElementById("businessFaviconUrl")?.value.trim(),
    seoTitle: document.getElementById("businessSeoTitle")?.value.trim(),
    seoDescription: document.getElementById("businessSeoDescription")?.value.trim(),
    aboutTitle: document.getElementById("businessAboutTitle")?.value.trim(),
    aboutDescription: document.getElementById("businessAboutDescription")?.value.trim(),
    aboutImageUrl: document.getElementById("businessAboutImageUrl")?.value.trim(),
    termsItemId: document.getElementById("businessTermsItemId")?.value.trim(),
    termsPdfUrl: document.getElementById("businessTermsPdfUrl")?.value.trim(),
    privacyItemId: document.getElementById("businessPrivacyItemId")?.value.trim(),
    privacyPdfUrl: document.getElementById("businessPrivacyPdfUrl")?.value.trim(),
    supportItemId: document.getElementById("businessSupportItemId")?.value.trim(),
    supportPdfUrl: document.getElementById("businessSupportPdfUrl")?.value.trim(),
    commerceItemId: document.getElementById("businessCommerceItemId")?.value.trim(),
    commercePdfUrl: document.getElementById("businessCommercePdfUrl")?.value.trim(),
  };
}

async function uploadSettingFile(inputId, storagePath) {
  const file = document.getElementById(inputId)?.files?.[0];
  if (!file) return "";
  const fileRef = ref(storage, `${storagePath}/${Date.now()}-${file.name}`);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}

async function formDataWithUploads() {
  const data = formData();
  data.logoUploadedUrl = await uploadSettingFile("businessLogoFile", "business/logo");
  data.faviconUploadedUrl = await uploadSettingFile("businessFaviconFile", "business/favicon");
  data.aboutImageUploadedUrl = await uploadSettingFile("businessAboutImageFile", "business/about");
  data.termsPdfUploadedUrl = await uploadSettingFile("businessTermsPdfFile", "business/policies");
  data.privacyPdfUploadedUrl = await uploadSettingFile("businessPrivacyPdfFile", "business/policies");
  data.supportPdfUploadedUrl = await uploadSettingFile("businessSupportPdfFile", "business/policies");
  data.commercePdfUploadedUrl = await uploadSettingFile("businessCommercePdfFile", "business/policies");
  return data;
}

function updatePreview(business) {
  const preview = document.getElementById("businessSettingsPreview");
  if (!preview) return;
  const address = escapeHTML(business.address || "").replace(/\n/g, "<br>");
  preview.innerHTML = `
    <div class="flex items-start gap-3">
      ${business.logoUrl
    ? `<img src="${escapeHTML(business.logoUrl)}" alt=""
        class="h-14 w-14 rounded border border-gray-700 object-contain">`
    : ""}
      <div>
        <div class="font-semibold text-white">${escapeHTML(business.name || "Business name")}</div>
        <div class="text-sm text-gray-300">ABN: ${escapeHTML(business.abn || "-")}</div>
        <div class="text-sm text-gray-300">${address || "Address"}</div>
        <div class="text-sm text-gray-300">${escapeHTML(business.phone || "")}</div>
        <div class="text-sm text-gray-300">${escapeHTML(business.email || "")}</div>
      </div>
    </div>
  `;
}

async function loadBusinessSettings() {
  const getBusinessSettings = httpsCallable(functions, "getBusinessSettings");
  const result = await getBusinessSettings();
  const business = result.data || {};
  setFormValues(business);
  updatePreview(business);
}

export async function setupBusinessSettings() {
  const form = document.getElementById("businessSettingsForm");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";

  FIELD_IDS.forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => updatePreview(formData()));
  });

  document.getElementById("refreshBusinessSettingsBtn")?.addEventListener("click", async () => {
    await loadBusinessSettings();
    showToast("Business settings refreshed", "success");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveButton = form.querySelector("button[type='submit']");
    try {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
      const updateBusinessSettings = httpsCallable(functions, "updateBusinessSettings");
      const data = await formDataWithUploads();
      const result = await updateBusinessSettings(data);
      setFormValues(result.data?.business || data);
      updatePreview(result.data?.business || data);
      showToast("Business settings saved", "success");
    } catch (err) {
      console.error("Failed to save business settings:", err);
      showToast(err.message || "Failed to save business settings", "error");
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Save business settings";
    }
  });

  try {
    await loadBusinessSettings();
  } catch (err) {
    console.error("Failed to load business settings:", err);
    showToast(err.message || "Failed to load business settings", "error");
  }
}

export default setupBusinessSettings;
