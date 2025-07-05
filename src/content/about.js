// about.js – Initializes About Section

export function initAboutPage() {
  const section = document.getElementById("aboutSection");
  if (section) {
    section.classList.add("active");
    section.scrollIntoView({ behavior: "smooth" });
  }
}

export default initAboutPage;
