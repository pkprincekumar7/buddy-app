/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Hardcoded HSL values matching global.css CSS variables.
        // NativeWind v4 on React Native does not resolve CSS custom properties
        // (hsl(var(--x))) at runtime — colours must be concrete values here.
        background: 'hsl(0, 0%, 4%)',         // --background
        foreground: 'hsl(0, 0%, 98%)',        // --foreground
        card: {
          DEFAULT: 'hsl(0, 0%, 8%)',           // --card
          foreground: 'hsl(0, 0%, 98%)',       // --card-foreground
        },
        popover: {
          DEFAULT: 'hsl(0, 0%, 8%)',           // --popover
          foreground: 'hsl(0, 0%, 98%)',       // --popover-foreground
        },
        primary: {
          DEFAULT: 'hsl(174, 72%, 56%)',       // --primary (teal)
          foreground: '#0a0a0a',
        },
        secondary: {
          DEFAULT: 'hsl(0, 0%, 12%)',          // --secondary
          foreground: 'hsl(0, 0%, 98%)',       // --secondary-foreground
        },
        muted: {
          DEFAULT: 'hsl(0, 0%, 12%)',          // --muted
          foreground: 'hsl(0, 0%, 55%)',       // --muted-foreground
        },
        accent: {
          DEFAULT: 'hsl(0, 0%, 12%)',          // --accent
          foreground: 'hsl(0, 0%, 98%)',       // --accent-foreground
        },
        destructive: {
          DEFAULT: 'hsl(0, 62.8%, 30.6%)',     // --destructive
          foreground: 'hsl(0, 0%, 98%)',       // --destructive-foreground
        },
        border: 'hsl(0, 0%, 15%)',             // --border
        input: 'hsl(0, 0%, 15%)',              // --input
        ring: 'hsl(174, 72%, 56%)',            // --ring
        surface: {
          elevated: 'hsl(0, 0%, 10.2%)',       // --surface-elevated
          input:    'hsl(0, 0%, 12%)',          // --surface-input
        },
      },
    },
  },
  plugins: [],
};
