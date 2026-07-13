import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase-config.js";

let cachedBusinessProfile = null;

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element && value) element.textContent = value;
}

function setImage(id, value) {
  const element = document.getElementById(id);
  if (element && value) element.src = value;
}

function setMeta(selector, value) {
  if (value) document.querySelector(selector)?.setAttribute("content", value);
}

function setFavicon(value) {
  if (!value) return;
  document.getElementById("faviconIco")?.setAttribute("href", value);
  document.getElementById("faviconSvg")?.setAttribute("href", value);
}

export async function getBusinessProfile() {
  if (cachedBusinessProfile) return cachedBusinessProfile;
  const getBusinessSettings = httpsCallable(functions, "getBusinessSettings");
  const result = await getBusinessSettings();
  cachedBusinessProfile = result.data || {};
  window.recoveryBusinessProfile = cachedBusinessProfile;
  return cachedBusinessProfile;
}

export async function applyBusinessProfile() {
  try {
    const business = await getBusinessProfile();

    setImage("headerBusinessLogo", business.logoUrl);
    setImage("footerBusinessLogo", business.logoUrl);
    setText("headerBusinessName", business.name);
    setText("footerBusinessName", business.name);
    setFavicon(business.faviconUrl);
    setMeta("meta[name='description']", business.seoDescription);
    setMeta("meta[property='og:title']", business.seoTitle || business.name);
    setMeta("meta[property='og:description']", business.seoDescription);
    setMeta("meta[property='og:image']", business.logoUrl);
    setMeta("meta[name='twitter:title']", business.seoTitle || business.name);
    setMeta("meta[name='twitter:description']", business.seoDescription);
    setMeta("meta[name='twitter:image']", business.logoUrl);

    const footerText = document.querySelector("footer .mt-6");
    if (footerText && business.name && business.abn) {
      footerText.innerHTML = `
        &copy; 2025 <a href="https://recoverytools.au" class="text-[#407471] hover:underline">recoverytools.au</a>.
        All rights reserved.<br>
        ${escapeHTML(business.name)} - ABN ${escapeHTML(business.abn)}.
        All prices include GST where applicable.
      `;
    }
  } catch (err) {
    console.warn("Business profile could not be loaded. Using default page details.", err);
  }
}
