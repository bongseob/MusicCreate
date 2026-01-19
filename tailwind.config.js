/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0b',
        surface: '#161618',
        accent: '#3b82f6',
        accentHover: '#2563eb',
        border: '#2e2e32',
        textPrimary: '#f4f4f5',
        textSecondary: '#a1a1aa'
      },
    },
  },
  plugins: [],
}
