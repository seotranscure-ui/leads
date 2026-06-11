/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1f2733',
        muted: '#6b7686',
        line: '#e3e8f0',
        brand: '#0e7c66',
        brand2: '#0b6f8a',
      },
    },
  },
  plugins: [],
}
