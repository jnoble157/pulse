/**
 * Tailwind config — `docs/DESIGN.md` tokens made real.
 *
 * Every color / radius / spacing / shadow name here matches DESIGN.md §2–§5.
 * If a color is missing, add it to DESIGN.md first, then wire it here. Never
 * inline a hex in a component.
 */
import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  content: ['./app/**/*.{ts,tsx,mdx}', './components/**/*.{ts,tsx,mdx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#FAF8F3',
          surface: '#FFFFFF',
          'surface-2': '#F4F1E8',
          'surface-3': '#ECE7D8',
        },
        border: {
          DEFAULT: 'rgba(10, 10, 10, 0.06)',
          strong: 'rgba(10, 10, 10, 0.12)',
        },
        text: {
          primary: '#0A0A0A',
          secondary: 'rgba(10, 10, 10, 0.62)',
          muted: 'rgba(10, 10, 10, 0.42)',
          disabled: 'rgba(10, 10, 10, 0.24)',
        },
        accent: {
          yellow: '#F5C518',
          'yellow-hover': '#E6B300',
          'yellow-subtle': 'rgba(245, 197, 24, 0.18)',
          'yellow-border': 'rgba(245, 197, 24, 0.55)',
          black: '#0A0A0A',
          'black-hover': '#1F1F1F',
        },
        fn: {
          success: '#2E9E52',
          warning: '#E89C18',
          danger: '#D04336',
          info: '#3A7FD1',
        },
        chip: {
          amber: '#E89C18',
          red: '#D04336',
          'yellow-2': '#D9A908',
          purple: '#8B5FBF',
          green: '#2E9E52',
          blue: '#3A7FD1',
          'red-hot': '#E0281C',
        },
        // Legacy aliases (kept until all surfaces migrate; don't add new usage).
        cream: {
          base: '#FAF8F3',
          warm: '#F4F1E8',
          edge: 'rgba(10, 10, 10, 0.12)',
        },
        ink: {
          900: '#0A0A0A',
          700: 'rgba(10, 10, 10, 0.62)',
          500: 'rgba(10, 10, 10, 0.42)',
          300: 'rgba(10, 10, 10, 0.24)',
        },
        pulse: {
          accent: '#0A0A0A',
          'accent-dim': '#1F1F1F',
          signal: {
            demand: '#E89C18',
            churn: '#D04336',
            ops: '#3A7FD1',
            ai: '#8B5FBF',
          },
        },
      },
      fontFamily: {
        sans: ['var(--font-geist)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '20px' }],
        base: ['15px', { lineHeight: '24px' }],
        lg: ['17px', { lineHeight: '26px' }],
        xl: ['20px', { lineHeight: '28px' }],
        '2xl': ['24px', { lineHeight: '32px' }],
        '3xl': ['32px', { lineHeight: '40px' }],
        '4xl': ['44px', { lineHeight: '52px' }],
        '5xl': ['60px', { lineHeight: '64px' }],
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '20px',
        pill: '999px',
      },
      spacing: {
        '0.5': '4px',
        '1': '8px',
        '2': '16px',
        '3': '24px',
        '4': '32px',
        '5': '40px',
        '6': '48px',
        '8': '64px',
        '10': '80px',
        '12': '96px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(10,10,10,0.04)',
        md: '0 4px 12px rgba(10,10,10,0.06)',
        lg: '0 12px 32px rgba(10,10,10,0.08)',
      },
      transitionDuration: {
        '150': '150ms',
      },
      transitionTimingFunction: {
        pulse: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      maxWidth: {
        inbox: '768px',
        detail: '1024px',
        call: '1152px',
      },
    },
  },
  plugins: [typography],
};

export default config;
