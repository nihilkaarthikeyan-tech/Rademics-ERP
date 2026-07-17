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

// Soft, LIGHT neutral ramp with a gentle indigo bias (2026-07-17 direction:
// "light colours only, no plain white"). Light shades carry a soft lavender tint
// so surfaces/borders never read as stark grey-on-white; dark shades stay ink.
const neutral = {
  50: '#F1F1FB', // page wash
  100: '#ECEDF8', // soft fills / hover / tracks
  200: '#E4E5F2', // tinted hairline
  300: '#D4D5E3',
  400: '#9C9CB0',
  500: '#6E6E82',
  600: '#565669',
  700: '#42424F',
  800: '#26262E',
  900: '#1C1C24',
  950: '#0C0C10',
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
          soft: '#E7E8FE', // soft indigo wash — active nav pill, KPI tile
        },
        // Soft pastel tints (light colours only) — KPI tiles + coloured status.
        // Each has a pale `soft` background and a readable `DEFAULT` ink for the glyph/text.
        success: { soft: '#DEF3E5', DEFAULT: '#1E874A' },
        warning: { soft: '#FAEDD3', DEFAULT: '#A96D12' },
        danger: { soft: '#FCE1E6', DEFAULT: '#C81E63' },
        info: { soft: '#DDEBFB', DEFAULT: '#2563EB' },
        teal: { soft: '#D6F1ED', DEFAULT: '#0D9488' },
        // No stark white — cards sit a whisper off pure white on the pastel page.
        white: '#FCFCFF',
        // Remap slate → soft tinted neutral so the whole app softens at once.
        slate: neutral,
      },
      boxShadow: {
        // Indigo-tinted elevation — the quiet "premium" tell.
        card: '0 1px 2px rgba(24,24,40,.05), 0 1px 3px rgba(24,24,40,.05)',
        'card-hover': '0 6px 16px -4px rgba(30,27,75,.10), 0 2px 6px -2px rgba(30,27,75,.06)',
        lift: '0 18px 40px -12px rgba(30,27,75,.18), 0 6px 14px -6px rgba(30,27,75,.10)',
        accent: '0 10px 24px -8px rgba(79,70,229,.50)',
        // Aurora Glass elevation — colour-tinted (indigo→violet→pink) so frosted
        // surfaces cast a soft aurora shadow instead of a flat grey one.
        glass: '0 16px 44px -20px rgba(79,70,229,.42), 0 6px 18px -10px rgba(139,92,246,.22)',
        'glass-hover': '0 24px 54px -22px rgba(79,70,229,.50), 0 10px 24px -12px rgba(236,72,153,.24)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        rise: 'rise .55s cubic-bezier(.2,.75,.2,1) both',
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
