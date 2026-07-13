import { renderPolicyPage } from "./policy-page.js";

export function initPrivacyPage() {
  return renderPolicyPage({
    sectionId: "privacySection",
    title: "Privacy Policy",
    pdfField: "privacyPdfUrl",
    fallback: "Privacy Policy PDF has not been uploaded yet.",
  });
}

export default initPrivacyPage;
