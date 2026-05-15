import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        'glow':         '0 0 32px rgb(212 160 23 / 0.18), 0 0 64px rgb(212 160 23 / 0.06)',
        'glow-gold':    '0 0 28px rgb(245 200 66 / 0.35), 0 0 56px rgb(212 160 23 / 0.12)',
        'glow-emerald': '0 0 24px rgb(16 185 129 / 0.25), 0 0 48px rgb(16 185 129 / 0.10)',
        'glow-red':     '0 0 24px rgb(239 68 68 / 0.25), 0 0 48px rgb(239 68 68 / 0.10)',
        'glow-amber':   '0 0 24px rgb(245 158 11 / 0.25), 0 0 48px rgb(245 158 11 / 0.10)',
        'card-soft':    '0 1px 2px rgb(0 0 0 / 0.20), 0 8px 24px rgb(0 0 0 / 0.30)',
        'card-lift':    '0 1px 2px rgb(0 0 0 / 0.20), 0 16px 40px rgb(0 0 0 / 0.40)',
      },
      backgroundImage: {
        'gradient-primary':  'linear-gradient(135deg, #fde68a 0%, #f5c842 35%, #d4a017 70%, #b8860b 100%)',
        'gradient-gold':     'linear-gradient(135deg, #fde68a 0%, #f5c842 35%, #d4a017 70%, #b8860b 100%)',
        'gradient-emerald':  'linear-gradient(135deg, #059669 0%, #10b981 100%)',
        'gradient-rose':     'linear-gradient(135deg, #e11d48 0%, #f43f5e 100%)',
        'gradient-amber':    'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
        'gradient-mesh':     'radial-gradient(at 12% 12%, rgb(212 160 23 / 0.12) 0px, transparent 55%), radial-gradient(at 88% 0%, rgb(245 200 66 / 0.08) 0px, transparent 55%), radial-gradient(at 70% 95%, rgb(184 134 11 / 0.08) 0px, transparent 55%)',
        'gradient-strip':    'linear-gradient(90deg, transparent, rgb(212 160 23 / 0.55), transparent)',
      },
      keyframes: {
        'fade-in':       { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-right':{ '0%': { opacity: '0', transform: 'translateX(20px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        'slide-up':      { '0%': { opacity: '0', transform: 'translateY(8px)' },  '100%': { opacity: '1', transform: 'translateY(0)' } },
        'pulse-glow':    { '0%,100%': { boxShadow: '0 0 0 0 rgb(245 200 66 / 0.45)' }, '50%': { boxShadow: '0 0 0 6px rgb(245 200 66 / 0)' } },
        'pulse-soft':    { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.6' } },
        'shimmer':       { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        'gradient-shift':{ '0%,100%': { backgroundPosition: '0% 50%' }, '50%': { backgroundPosition: '100% 50%' } },
      },
      animation: {
        'fade-in':        'fade-in 0.45s cubic-bezier(0.16,1,0.3,1) both',
        'slide-in-right': 'slide-in-right 0.4s cubic-bezier(0.16,1,0.3,1) both',
        'slide-up':       'slide-up 0.35s cubic-bezier(0.16,1,0.3,1) both',
        'pulse-glow':     'pulse-glow 2.2s ease-in-out infinite',
        'pulse-soft':     'pulse-soft 2.4s ease-in-out infinite',
        'shimmer':        'shimmer 2.5s linear infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
