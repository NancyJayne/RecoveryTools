import { renderPolicyPage } from "./policy-page.js";

export function initTermsPage() {
  return renderPolicyPage({
    sectionId: "termsSection",
    title: "Terms & Conditions",
    pdfField: "termsPdfUrl",
    fallback: "Terms & Conditions PDF has not been uploaded yet.",
  });
}

export default initTermsPage;
