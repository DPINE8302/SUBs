/** @type {import('tailwindcss').Config} */
import forms from '@tailwindcss/forms';

export default {
  content: [
    './src/**/*.{html,js,svelte,ts}',
    './static/**/*.{html,js}'
  ],
  theme: {
    extend: {
      colors: {
        piano: '#0B0B0B',
        'old-money': '#1E3D32',
        gilded: '#D4AF37',
        slate: '#202123',
        mist: '#6C7075'
      },
      fontFamily: {
        display: ['"SF Pro Display"', 'SFProDisplay', 'system-ui', 'sans-serif'],
        text: ['"SF Pro Text"', 'SFProText', 'system-ui', 'sans-serif'],
        mono: ['"SF Mono"', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        hud: '0 8px 24px rgba(0, 0, 0, 0.35)'
      },
      spacing: {
        7.5: '1.875rem'
      },
      transitionTimingFunction: {
        'ease-cubic': 'cubic-bezier(0.4, 0, 0.2, 1)'
      }
    }
  },
  plugins: [forms]
};
