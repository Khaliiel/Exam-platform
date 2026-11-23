/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { canvas: "#F8F7F4", navy: "#1B365D", amber: { DEFAULT: "#D97706" }, crimson: "#B91C1C", ink: "#1c2430", rule: "#e4e0d6" },
      fontFamily: { serif: ["var(--stack)"], sans: ["var(--stack)"] },
    },
  },
  plugins: [],
};
