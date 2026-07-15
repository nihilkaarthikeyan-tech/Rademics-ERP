import type { Config } from 'tailwindcss';
import preset from '@rademics/ui/tailwind-preset';

const config: Config = {
  presets: [preset as Partial<Config>],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Client-portal-only login identity — deliberately distinct from the
        // internal app's brand.blue/brand.navy so the two products don't look
        // like the same login screen at a glance.
        client: {
          teal: '#0D9488',
          deep: '#0F3D3A',
        },
      },
    },
  },
};

export default config;
