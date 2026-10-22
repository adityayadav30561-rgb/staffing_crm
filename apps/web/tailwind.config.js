// Nirman design tokens (docs/design/tokens.json). The CRM type scale is the 1240px-frame scale
// enlarged ~1.2x for a full-screen app: fs-9 -> 11px, fs-11 -> 13px, fs-24 -> 28px.
// Spacing is in px like the design spec ("padding 12 x 7" -> px-12 py-7).
const px = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 112, 128, 160, 192, 224, 240, 256, 288, 320, 360, 384, 420, 480, 560, 640, 720];
const spacing = Object.fromEntries(px.map((n) => [n, `${n}px`]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    spacing: { ...spacing, px: '1px' },
    extend: {
      colors: {
        paper: { DEFAULT: '#f6f2ea', 2: '#eee8dc', 3: '#e4dccb' },
        surface: '#ffffff',
        ink: { DEFAULT: '#16181b', 2: '#474c52', 3: '#80868c' },
        line: '#e3ddd1',
        forest: { DEFAULT: '#123b32', 2: '#1e5a4b', deep: '#0b2620' },
        mint: { DEFAULT: '#9fdcb8', soft: '#e0f1e6' },
        sage: { 2: '#b8dcc6', 3: '#86bd9c' },
        moss: '#4f9a74',
        sidebar: '#f3f1ea',
        detail: '#faf9f5',
        cobalt: { DEFAULT: '#3346d3', 2: '#2433a6', soft: '#e3e7fc' },
        coral: { DEFAULT: '#ec6a4c', 2: '#c9502f', soft: '#fbe3d9' },
        marigold: { DEFAULT: '#f4b23e', 2: '#d9921a', soft: '#fcedc9' },
        peacock: { DEFAULT: '#1f6f78', soft: '#d8ecea' },
        lilac: { DEFAULT: '#c7b9f3', soft: '#ece6fc' },
        rose: { DEFAULT: '#d9668f', soft: '#f8dde6' },
        signal: { red: '#d24b36', blue: '#3346d3' },
        brass: { DEFAULT: '#d9921a', soft: '#fcedc9', text: '#7a5d2c' },
        negotiation: '#e3e9ef',
        chart: { 1: '#1f4d3a', 2: '#6f8f72', 3: '#c9a76a', 4: '#c3cfbd' },
      },
      fontFamily: {
        display: ['"Mona Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Funnel Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        8: ['10px', '1.3'],
        9: ['11px', '1.35'],
        10: ['12px', '1.35'],
        11: ['13px', '1.4'],
        12: ['14px', '1.4'],
        14: ['16px', '1.35'],
        16: ['19px', '1.2'],
        18: ['22px', '1.1'],
        24: ['28px', '1'],
      },
      borderRadius: { xs: '2px', sm: '4px', md: '6px', lg: '8px', xl: '12px', '2xl': '16px' },
      boxShadow: {
        panel: '0 1px 2px rgb(22 24 27 / 0.06), 0 10px 30px -14px rgb(22 24 27 / 0.22)',
        lift: '0 30px 60px -30px rgb(22 24 27 / 0.45)',
        pop: '0 12px 40px -12px rgb(22 24 27 / 0.35), 0 0 0 1px rgb(22 24 27 / 0.08)',
      },
      width: { sidebar: '232px', detail: '384px' },
      transitionTimingFunction: { settle: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      keyframes: { pop: { from: { opacity: '0' }, to: { opacity: '1' } } },
      animation: { pop: 'pop 180ms ease-out' },
    },
  },
  plugins: [],
};
