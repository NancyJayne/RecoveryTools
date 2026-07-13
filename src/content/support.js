import { renderPolicyPage } from "./policy-page.js";

export function initSupportPage() {
  return renderPolicyPage({
    sectionId: "supportSection",
    title: "Support",
    pdfField: "supportPdfUrl",
    fallback: "Support PDF has not been uploaded yet.",
  });
}

export default initSupportPage;
