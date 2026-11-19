/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sun: '#FFC93C',
        ember: '#FF7A2F',
        sky: '#3A7BFF',
        grape: '#8B5CF6',
        ink: { 50: '#f7f7fb', 100: '#eeeef5', 200: '#dcdce8', 300: '#b9b9cc', 400: '#8a8aa3', 500: '#62627a', 600: '#45455a', 700: '#2e2e3e', 800: '#1d1d29', 900: '#13131c', 950: '#0b0b12' }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        glow: '0 10px 40px -10px rgba(139,92,246,0.35), 0 4px 18px -6px rgba(255,122,47,0.25)'
      }
    }
  },
  plugins: []
};
