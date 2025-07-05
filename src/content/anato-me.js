// Browse short stories
// src/content/anato-me.js

export function initAnatoMePage() {
  const container = document.getElementById("anatoMeSection") || createFallbackSection();

  container.innerHTML = ""; // Clear any old content

  const wrapper = document.createElement("div");
  wrapper.className = "max-w-3xl mx-auto text-center mt-12 px-4";

  const heading = document.createElement("h1");
  heading.className = "text-3xl font-bold text-white mb-4";
  heading.textContent = "Anato-Me Stories";

  const paragraph = document.createElement("p");
  paragraph.className = "text-gray-400 mb-6";
  paragraph.textContent =
    "Our anatomy-inspired stories explain common pain issues in a way that's " +
    "relatable, raw, and real. Stay tuned for episodes.";

  const comingSoon = document.createElement("div");
  comingSoon.className = "text-sm text-gray-500";
  comingSoon.textContent = "Coming soon...";

  wrapper.append(heading, paragraph, comingSoon);
  container.appendChild(wrapper);
}

function createFallbackSection() {
  const section = document.createElement("section");
  section.id = "anatoMeSection";
  document.querySelector("main")?.appendChild(section);
  return section;
}
export default initAnatoMePage;
