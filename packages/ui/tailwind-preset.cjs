/**
 * Shared Tailwind preset — one design system across both apps (Spec §9).
 *
 * Interior chrome is a light neutral ramp (no hue) with ONE restrained indigo
 * accent (#4F46E5) reserved for interactive elements — primary buttons, focus
 * rings, active nav/tab states, links, progress bars. Everything else (surfaces,
 * borders, body text) stays neutral. Status badges still encode meaning via
 * weight/icon/label, never color (see Badge / dashboard-overview).
 *
 * The `brand` blue/navy/gold remain ONLY for the login screen, which keeps its
 * light bluish identity (navy #1B2A4A, blue #2563EB, gold #C9A227).
 */

// Pure neutral ramp (no blue bias). Replaces the default cool `slate`.
const neutral = {
  50: '#FAFAFA',
  100: '#F5F5F5',
  200: '#E5E5E5',
  300: '#D4D4D4',
  400: '#A3A3A3',
  500: '#737373',
  600: '#525252',
  700: '#404040',
  800: '#262626',
  900: '#171717',
  950: '#0A0A0A',
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // dark mode is V1-optional (§9); wired but off by default
  theme: {
    extend: {
      colors: {
        // Login-only brand palette (interior is monochrome).
        brand: {
          navy: '#1B2A4A',
          blue: '#2563EB',
          gold: '#C9A227',
        },
        // Interior primary action + focus ring = one restrained indigo accent.
        primary: {
          DEFAULT: '#4F46E5',
          foreground: '#FFFFFF',
        },
        accent: {
          DEFAULT: '#4F46E5',
          foreground: '#FFFFFF',
        },
        // Remap slate → pure neutral so the whole app goes black-and-white at once.
        slate: neutral,
      },
      fontFamily: {
        // Each app defines --font-sans / --font-mono via next/font (self-hosted).
        // Falls back to Inter / system stack if the variable is ever absent.
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
