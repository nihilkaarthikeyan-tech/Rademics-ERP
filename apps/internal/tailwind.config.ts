import type { Config } from 'tailwindcss';
import preset from '@rademics/ui/tailwind-preset';

/**
 * Staff app look (2026-10-09, owner chose "Option B, Teams-style"): a light grey
 * shell, solid white surfaces with thin borders, brand navy for the app bar and
 * one clear blue for actions. Overrides the shared preset for this app only, so
 * the client portal and the desktop app keep their own looks.
 */
const gray = {
  50: '#F9FAFB',
  100: '#F2F4F7',
  200: '#E4E7EC',
  300: '#D0D5DD',
  400: '#98A2B3',
  500: '#667085',
  600: '#475467',
  700: '#344054',
  800: '#1D2939',
  900: '#101828',
  950: '#0C111D',
};

const config: Config = {
  presets: [preset as Partial<Config>],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        white: '#FFFFFF',
        slate: gray,
        primary: { DEFAULT: '#2F54C9', foreground: '#FFFFFF' },
        accent: { DEFAULT: '#2F54C9', foreground: '#FFFFFF', soft: '#E8EEFC' },
        shell: '#F3F4F7',
        rail: '#EBEDF2',
      },
      boxShadow: {
        // Flat, neutral elevation: a hairline plus a whisper of depth.
        glass: '0 1px 2px rgba(16,24,40,.06), 0 0 0 1px rgba(16,24,40,.04)',
        'glass-hover': '0 4px 12px -2px rgba(16,24,40,.10), 0 0 0 1px rgba(16,24,40,.05)',
        accent: '0 1px 2px rgba(16,24,40,.08)',
      },
    },
  },
};

export default config;
