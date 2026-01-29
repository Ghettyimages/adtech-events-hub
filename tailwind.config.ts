import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        tmc: {
          ink: 'var(--tmc-ink)',
          navy: 'var(--tmc-navy)',
          blue: 'var(--tmc-blue)',
          cyan: 'var(--tmc-cyan)',
          'cyan-soft': 'var(--tmc-cyan-soft)',
          bg: 'var(--tmc-bg)',
          surface: 'var(--tmc-surface)',
          border: 'var(--tmc-border)',
          muted: 'var(--tmc-muted)',
        },
      },
      backgroundImage: {
        'tmc-gradient': 'var(--tmc-gradient)',
      },
    },
  },
  plugins: [],
}
export default config
