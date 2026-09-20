import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./axon/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1280px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        // Synapth brand: one acid-green signal on graphite. See design.md §2.
        synapse: {
          DEFAULT: "hsl(var(--synapse))",
          foreground: "hsl(var(--synapse-foreground))",
          muted: "hsl(var(--synapse) / 0.1)",
          dim: "hsl(var(--synapse-dim))",
        },
        // Tonal surface stack for wells, tiles and hover states (design.md §2).
        surface: {
          lowest: "hsl(var(--surface-lowest))",
          low: "hsl(var(--surface-low))",
          DEFAULT: "hsl(var(--surface))",
          high: "hsl(var(--surface-high))",
          highest: "hsl(var(--surface-highest))",
        },
        moss: "hsl(var(--secondary-tone))",
        warn: "hsl(var(--warn))",
        danger: "hsl(var(--danger))",
        info: "hsl(var(--info))",
      },
      // Stitch screens: 6px controls, 8px inputs/buttons, 12px cards, 16px hero panels.
      borderRadius: {
        "2xl": "calc(var(--radius) + 10px)",
        xl: "calc(var(--radius) + 6px)",
        lg: "calc(var(--radius) + 2px)",
        md: "var(--radius)",
        sm: "2px",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 16px hsl(var(--synapse) / 0.35)",
        "glow-lg": "0 0 24px hsl(var(--synapse) / 0.35)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        pulseDot: { "0%, 100%": { opacity: "0.4" }, "50%": { opacity: "1" } },
        ping: { "75%, 100%": { transform: "scale(2.2)", opacity: "0" } },
        // Glass panels on the auth gate drift a few pixels on slow sine loops.
        floatSlow: { "0%, 100%": { transform: "translateY(0) rotate(0deg)" }, "50%": { transform: "translateY(-8px) rotate(0.5deg)" } },
        floatReverse: { "0%, 100%": { transform: "translateY(0) rotate(0deg)" }, "50%": { transform: "translateY(10px) rotate(-0.5deg)" } },
        // HUD toasts slide in from the right edge; the progress rule drains for the toast's lifetime.
        toastIn: { from: { transform: "translateX(16px)" }, to: { transform: "translateX(0)" } },
        toastDrain: { from: { width: "100%" }, to: { width: "0%" } },
        drawerIn: { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-dot": "pulseDot 1.6s ease-in-out infinite",
        "float-slow": "floatSlow 9s ease-in-out infinite",
        "float-reverse": "floatReverse 11s ease-in-out infinite",
        "toast-in": "toastIn 0.25s ease-out",
        "toast-drain": "toastDrain linear forwards",
        "drawer-in": "drawerIn 0.25s ease-out",
      },
    },
  },
  plugins: [animate],
};

export default config;
