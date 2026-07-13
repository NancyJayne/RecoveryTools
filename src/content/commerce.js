import { renderPolicyPage } from "./policy-page.js";

export function initCommercePage() {
  return renderPolicyPage({
    sectionId: "commerceSection",
    title: "Commerce Info",
    pdfField: "commercePdfUrl",
    fallback: "Commerce PDF has not been uploaded yet.",
  });
}

export default initCommercePage;
