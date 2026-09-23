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
        drawerOut: { from: { transform: "translateX(0)" }, to: { transform: "translateX(100%)" } },
        fadeOut: { from: { opacity: "1" }, to: { opacity: "0" } },
        // Impulse cell: resting halo, the ring thrown on fire, sparks along `--a` for `--d`, and the rolling counter.
        impulseHalo: { "0%, 100%": { transform: "scale(1)", opacity: "0.45" }, "50%": { transform: "scale(1.35)", opacity: "0" } },
        impulseRing: { from: { transform: "scale(0.8)", opacity: "1" }, to: { transform: "scale(2.4)", opacity: "0" } },
        impulseSpark: {
          from: { transform: "rotate(var(--a)) translateX(10px) scaleX(1)", opacity: "1" },
          to: { transform: "rotate(var(--a)) translateX(var(--d)) scaleX(0.2)", opacity: "0" },
        },
        countUp: { from: { transform: "translateY(70%)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        countDown: { from: { transform: "translateY(-70%)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        // Generic entrance: pages, panels, list rows (see `.stagger` in globals.css).
        rise: { from: { transform: "translateY(8px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        popIn: { from: { transform: "translateY(4px) scale(0.96)", opacity: "0" }, to: { transform: "translateY(0) scale(1)", opacity: "1" } },
        segmentIn: { from: { transform: "scaleY(0.2)", opacity: "0" }, to: { transform: "scaleY(1)", opacity: "1" } },
        bellRing: { "0%, 100%": { transform: "rotate(0)" }, "15%": { transform: "rotate(14deg)" }, "30%": { transform: "rotate(-12deg)" }, "45%": { transform: "rotate(8deg)" }, "60%": { transform: "rotate(-5deg)" }, "75%": { transform: "rotate(2deg)" } },
        shimmer: { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-dot": "pulseDot 1.6s ease-in-out infinite",
        "float-slow": "floatSlow 9s ease-in-out infinite",
        "float-reverse": "floatReverse 11s ease-in-out infinite",
        "toast-in": "toastIn 0.25s ease-out",
        "toast-drain": "toastDrain linear forwards",
        "drawer-in": "drawerIn 0.25s cubic-bezier(0.2, 0.8, 0.3, 1)",
        "drawer-out": "drawerOut 0.22s cubic-bezier(0.5, 0, 0.75, 0) forwards",
        "fade-out": "fadeOut 0.22s ease-in forwards",
        "impulse-halo": "impulseHalo 2.4s ease-in-out infinite",
        "impulse-ring": "impulseRing 0.6s cubic-bezier(0.2, 0.7, 0.3, 1) forwards",
        "impulse-spark": "impulseSpark 0.55s cubic-bezier(0.2, 0.7, 0.3, 1) forwards",
        "count-up": "countUp 0.35s cubic-bezier(0.2, 0.8, 0.3, 1)",
        "count-down": "countDown 0.35s cubic-bezier(0.2, 0.8, 0.3, 1)",
        rise: "rise 0.45s cubic-bezier(0.2, 0.7, 0.3, 1) backwards",
        "fade-in": "fadeIn 0.3s ease-out both",
        "pop-in": "popIn 0.18s cubic-bezier(0.2, 0.8, 0.3, 1) both",
        "segment-in": "segmentIn 0.35s cubic-bezier(0.2, 0.8, 0.3, 1) both",
        "bell-ring": "bellRing 0.8s ease-in-out",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [animate],
};

export default config;
