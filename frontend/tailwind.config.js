/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        obsidian: {
          950: '#040711',
          900: '#070B18',
          850: '#0B1124',
          800: '#101935',
          700: '#19254B',
        },
        navy: {
          950: '#060a16',
          900: '#0b1020',
          800: '#121a33',
          700: '#1b2547',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,.04), 0 8px 24px -6px rgba(15,23,42,.08)',
        lift: '0 2px 6px rgba(15,23,42,.05), 0 20px 44px -12px rgba(15,23,42,.16)',
        glow: '0 0 0 1px rgba(56,189,248,.28), 0 12px 44px -10px rgba(56,189,248,.45)',
        'glow-indigo': '0 0 0 1px rgba(99,102,241,.3), 0 12px 44px -10px rgba(99,102,241,.5)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        dash: { to: { strokeDashoffset: '0' } },
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        pulseRing: {
          '0%': { transform: 'scale(0.8)', opacity: '0.8' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        floaty: 'floaty 4s ease-in-out infinite',
        'pulse-ring': 'pulseRing 2s cubic-bezier(0.16, 1, 0.3, 1) infinite',
      },
    },
  },
  plugins: [],
}
