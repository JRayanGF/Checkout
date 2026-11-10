module.exports = {
  content: ['./public/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        ink: '#14211C',
        paper: '#F5F6F3',
        moss: { DEFAULT: '#0E6B58', dark: '#0A5646', soft: '#E3F0EC' },
        line: '#DCE1DC',
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'],
        display: ['Georgia', '"Iowan Old Style"', 'serif'],
      },
    },
  },
};
