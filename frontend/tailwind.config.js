import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      keyframes: {
        'glow-ring': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(37, 99, 235, 0.35)' },
          '50%': { boxShadow: '0 0 0 5px rgba(37, 99, 235, 0)' },
        },
      },
      animation: {
        'glow-ring': 'glow-ring 1.8s ease-out infinite',
      },
    },
  },
  plugins: [typography],
}
