/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary:        '#00490e',
        'primary-container': '#0d631b',
        'on-primary':   '#ffffff',
        secondary:      '#00639a',
        'secondary-container': '#7ec1fe',
        tertiary:       '#304047',
        'tertiary-container': '#47575f',
        surface:        '#f9f9f9',
        'surface-low':  '#f3f3f3',
        'surface-card': '#ffffff',
        'surface-high': '#e8e8e8',
        'surface-highest': '#e2e2e2',
        'on-surface':   '#1a1c1c',
        'on-surface-variant': '#40493d',
        'outline-variant': '#bfcaba',
        error:          '#ba1a1a',
        'error-container': '#ffdad6',
        warning:        '#e65100',
        'warning-container': '#fbe9e7',
      },
      fontFamily: {
        headline: ['Manrope', 'sans-serif'],
        body:     ['Inter', 'sans-serif'],
      },
      borderRadius: {
        xl: '1.5rem',
        md: '0.75rem',
      },
      boxShadow: {
        card: '0px 4px 12px rgba(26,28,28,0.04), 0px 8px 24px rgba(26,28,28,0.08)',
        fab:  '0 10px 30px -5px rgba(26,28,28,0.05), 0 5px 15px -8px rgba(26,28,28,0.08)',
        glow: {
          green:  '0 0 0 4px rgba(13,99,27,0.25)',
          blue:   '0 0 0 4px rgba(0,99,154,0.25)',
          red:    '0 0 0 4px rgba(186,26,26,0.25)',
          amber:  '0 0 0 4px rgba(230,81,0,0.25)',
        },
      },
      letterSpacing: {
        data: '0.02em',
      },
    },
  },
  plugins: [],
}
