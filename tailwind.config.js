/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./public/**/*.{html,js}",
    "./auth/**/*.{html,js}",
    "./admin/**/*.{html,js}",
    "./src/**/*.{html,js}",
  ],
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
    },
  },
  plugins: [],
  darkMode: "class",
};
