/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Optionnel : tu peux définir tes couleurs SilkGenesis ici
        // ex: 'silk-amber': '#b45309',
      },
    },
  },
  plugins: [],
}