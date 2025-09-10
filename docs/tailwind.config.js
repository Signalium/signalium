/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      typography: {
        DEFAULT: {
          css: {
            'blockquote p:first-of-type::before': {
              content: '',
            },
            'blockquote p:last-of-type::after': {
              content: '',
            },
            code: {
              backgroundColor: 'var(--color-primary-1000)',
              padding: '0 0.4rem',
              marginTop: '-0.20rem',
              marginBottom: '-0.15rem',
              borderRadius: '0.25rem',
              border: '1px solid var(--color-divider)',
              color: 'var(--color-pink-400)',
            },
            'code::before': {
              content: '""',
            },
            'code::after': {
              content: '""',
            },
          },
        },
      },
    },
  },
};
