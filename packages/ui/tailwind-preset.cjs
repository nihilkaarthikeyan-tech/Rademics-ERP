/**
 * Shared Tailwind preset — one design system across both apps (Spec §9).
 * Brand tokens are PLACEHOLDERS until official assets arrive (Assumption #7):
 * navy #1B2A4A, accent blue #2563EB, gold #C9A227.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // dark mode is V1-optional (§9); wired but off by default
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#1B2A4A',
          blue: '#2563EB',
          gold: '#C9A227',
        },
        primary: {
          DEFAULT: '#1B2A4A',
          foreground: '#FFFFFF',
        },
        accent: {
          DEFAULT: '#2563EB',
          foreground: '#FFFFFF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
