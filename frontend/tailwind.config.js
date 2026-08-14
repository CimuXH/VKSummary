/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        warm: {
          50: '#faf9f6',
          100: '#f5f2ed',
          200: '#e8e5e0',
          300: '#d4d0c9',
          400: '#a8a39b',
          500: '#78716c',
          700: '#44403c',
          900: '#1c1917',
        },
        accent: {
          50: '#fef6f0',
          100: '#fde8da',
          400: '#f09b6e',
          500: '#e8794b',
          600: '#d46538',
        },
      },
      fontFamily: {
        sans: ['"Inter"', '"SF Pro Display"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
