/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./public/**/*.{html,js}",
    "./auth/**/*.{html,js}",
    "./admin/**/*.{html,js}",
    "./src/**/*.{html,js}",
  ],
  safelist: ['mobile-nav', 'mobile-nav-open'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#407471",
          dark: "#305a56",
          light: "#a2c5bf",
        },
        toast: {
          success: "#16a34a",
          error: "#dc2626",
          info: "#1f2937",
        },
      },
      fontFamily: {
        body: ["'Inter'", "sans-serif"],
        heading: ["'Poppins'", "sans-serif"],
      },
      boxShadow: {
        soft: "0 2px 10px rgba(0, 0, 0, 0.08)",
      },
      transitionProperty: {
        height: "height",
        spacing: "margin, padding",
      },
      keyframes: {
        slideIn: {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        slideOut: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "slide-in": "slideIn 0.3s ease-out forwards",
        "slide-out": "slideOut 0.3s ease-in forwards",
      },
    },
  },
  plugins: [],
  darkMode: "class",
};
