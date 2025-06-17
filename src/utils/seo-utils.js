export function setPageMeta({ title, description, url }) {
  document.title = title;

  let metaDesc = document.querySelector("meta[name=\"description\"]");
  if (!metaDesc) {
    metaDesc = document.createElement("meta");
    metaDesc.name = "description";
    document.head.appendChild(metaDesc);
  }
  metaDesc.content = description;

  let canonical = document.querySelector("link[rel=\"canonical\"]");
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  canonical.href = url || window.location.href;
}
