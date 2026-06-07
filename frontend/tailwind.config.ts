import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          action: 'hsl(var(--primary-action) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground))',
          light: 'hsl(var(--primary-light) / <alpha-value>)',
          medium: 'hsl(var(--primary-medium) / <alpha-value>)',
          dark: 'hsl(var(--primary-dark) / <alpha-value>)',
          stronger: 'hsl(var(--primary-stronger) / <alpha-value>)',
          xstrong: 'hsl(var(--primary-xstrong) / <alpha-value>)',
          'bg-light': 'hsl(var(--primary-bg-light) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          bright: 'hsl(var(--success-bright) / <alpha-value>)',
          light: 'hsl(var(--success-light) / <alpha-value>)',
          strong: 'hsl(var(--success-strong) / <alpha-value>)',
          xstrong: 'hsl(var(--success-xstrong) / <alpha-value>)',
          muted: 'hsl(var(--success-muted))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          light: 'hsl(var(--warning-light) / <alpha-value>)',
          medium: 'hsl(var(--warning-medium) / <alpha-value>)',
          strong: 'hsl(var(--warning-strong) / <alpha-value>)',
          orange: 'hsl(var(--warning-orange) / <alpha-value>)',
          'orange-medium': 'hsl(var(--warning-orange-medium) / <alpha-value>)',
        },
        error: {
          DEFAULT: 'hsl(var(--error) / <alpha-value>)',
          xlight: 'hsl(var(--error-xlight) / <alpha-value>)',
          light: 'hsl(var(--error-light) / <alpha-value>)',
          medium: 'hsl(var(--error-medium) / <alpha-value>)',
          strong: 'hsl(var(--error-strong) / <alpha-value>)',
          muted: 'hsl(var(--error-muted))',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          medium: 'hsl(var(--info-medium) / <alpha-value>)',
          strong: 'hsl(var(--info-strong) / <alpha-value>)',
          muted: 'hsl(var(--info-muted))',
        },
        personality: {
          DEFAULT: 'hsl(var(--personality) / <alpha-value>)',
          light: 'hsl(var(--personality-light) / <alpha-value>)',
          alt: 'hsl(var(--personality-alt) / <alpha-value>)',
          'alt-strong': 'hsl(var(--personality-alt-strong) / <alpha-value>)',
        },
        'accent-pink': 'hsl(var(--accent-pink) / <alpha-value>)',
        dim: 'hsl(var(--dim-foreground) / <alpha-value>)',
        subtle: 'hsl(var(--subtle-foreground) / <alpha-value>)',
        faint: 'hsl(var(--faint-foreground) / <alpha-value>)',
        xfaint: 'hsl(var(--xfaint-foreground) / <alpha-value>)',
        'surface-muted': 'hsl(var(--surface-muted-bg) / <alpha-value>)',
        'surface-dark': 'hsl(var(--surface-dark) / <alpha-value>)',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
        surface: {
          elevated: 'hsl(var(--surface-elevated))',
          input: 'hsl(var(--surface-input))',
        },
        section: {
          alt: 'hsl(var(--section-alt))',
          dark: 'hsl(var(--section-dark))',
        },
        scrollbar: {
          track: 'hsl(var(--scrollbar-track))',
          thumb: 'hsl(var(--scrollbar-thumb))',
          'thumb-hover': 'hsl(var(--scrollbar-thumb-hover))',
        },
      },
      height: {
        'btn-sm': '2.5rem',
        'btn-md': '2.75rem',
        'btn-lg': '3.25rem',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
