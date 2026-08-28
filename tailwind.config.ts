import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Brand color scales ─────────────────────────────────────
        azul: {
          50:  "#EFF3FD",
          100: "#D8E0FB",
          200: "#B1C2F7",
          300: "#8AA3F3",
          400: "#6384EF",
          500: "#2F52D3", // azul-eletrico — primary brand
          600: "#2644B8",
          700: "#1D369D",
          800: "#152882",
          900: "#0C1A67",
          950: "#080F3B",
          DEFAULT: "#2F52D3",
        },
        roxo: {
          50:  "#F5EDFD",
          100: "#E8D3FB",
          200: "#D1A8F7",
          300: "#B97CF3",
          400: "#A251EF",
          500: "#7B24C7", // roxo-luminoso — secondary brand
          600: "#6620A8",
          700: "#511C89",
          800: "#3C1869",
          900: "#27134A",
          950: "#150A2B",
          DEFAULT: "#7B24C7",
        },
        rosa: {
          50:  "#FDE8F2",
          100: "#FBCEE3",
          200: "#F79EC8",
          300: "#F36DAC",
          400: "#EF5298",
          500: "#E83D89", // rosa-vibrante — accent brand
          600: "#C93478",
          700: "#AA2B67",
          800: "#8B2256",
          900: "#6C1945",
          950: "#3D0E27",
          DEFAULT: "#E83D89",
        },
        ciano: {
          50:  "#E8F8FB",
          100: "#C8EFF5",
          200: "#91E0EB",
          300: "#5AD1E1",
          400: "#2DC2D7",
          500: "#17A2B8", // ciano-claro — support brand
          600: "#138799",
          700: "#0F6C7A",
          800: "#0B515B",
          900: "#07363C",
          950: "#041D20",
          DEFAULT: "#17A2B8",
        },
        dourado: {
          50:  "#FFFBE6",
          100: "#FFF5B3",
          200: "#FFEE80",
          300: "#FFE74D",
          400: "#FFE01A",
          500: "#FFD700", // dourado-ifizinha — IFizinha mascot
          600: "#D4B200",
          700: "#A98D00",
          800: "#7E6900",
          900: "#534500",
          950: "#2A2300",
          DEFAULT: "#FFD700",
        },
        // ── Legacy aliases (backward-compat with existing components) ──
        "azul-eletrico":  "#2F52D3",
        "roxo-luminoso":  "#7B24C7",
        "rosa-vibrante":  "#E83D89",
        "ciano-claro":    "#17A2B8",
        "dourado-ifizinha": "#FFD700",
        // ── shadcn/ui semantic tokens ─────────────────────────────
        border:     "hsl(var(--border))",
        input:      "hsl(var(--input))",
        ring:       "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT:    "#2F52D3",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT:    "#7B24C7",
          foreground: "#ffffff",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "#E83D89",
          foreground: "#ffffff",
        },
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
      },

      backgroundImage: {
        // ── Hero gradients ────────────────────────────────────────
        "hero-gradient":      "linear-gradient(135deg, #2F52D3 0%, #7B24C7 60%, #E83D89 100%)",
        "hero-gradient-r":    "linear-gradient(225deg, #2F52D3 0%, #7B24C7 60%, #E83D89 100%)",
        "hero-gradient-v":    "linear-gradient(180deg, #2F52D3 0%, #7B24C7 60%, #E83D89 100%)",
        "hero-gradient-soft": "linear-gradient(135deg, #2F52D3 0%, #7B24C7 100%)",
        // ── Card / content tints ──────────────────────────────────
        "card-gradient":      "linear-gradient(135deg, rgba(47,82,211,0.08) 0%, rgba(123,36,199,0.08) 100%)",
        "card-gradient-rosa": "linear-gradient(135deg, rgba(123,36,199,0.08) 0%, rgba(232,61,137,0.08) 100%)",
        "card-gradient-ciano":"linear-gradient(135deg, rgba(23,162,184,0.08) 0%, rgba(47,82,211,0.08) 100%)",
        // ── Dark overlays for hero sections ──────────────────────
        "hero-overlay":       "linear-gradient(180deg, rgba(15,20,60,0.25) 0%, rgba(15,20,60,0.55) 100%)",
        // ── Radial glow spots (IFizinha mascot / callout elements) ─
        "glow-azul":          "radial-gradient(ellipse at center, rgba(47,82,211,0.35) 0%, transparent 70%)",
        "glow-roxo":          "radial-gradient(ellipse at center, rgba(123,36,199,0.35) 0%, transparent 70%)",
        "glow-rosa":          "radial-gradient(ellipse at center, rgba(232,61,137,0.35) 0%, transparent 70%)",
        "glow-dourado":       "radial-gradient(ellipse at center, rgba(255,215,0,0.45) 0%, transparent 70%)",
        // ── Subtle section backgrounds ────────────────────────────
        "section-azul":       "linear-gradient(180deg, #EFF3FD 0%, #ffffff 100%)",
        "section-roxo":       "linear-gradient(180deg, #F5EDFD 0%, #ffffff 100%)",
        "section-rosa":       "linear-gradient(180deg, #FDE8F2 0%, #ffffff 100%)",
        // ── Shimmer effect (loading states) ──────────────────────
        "shimmer":            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)",
      },

      boxShadow: {
        "glow-azul":    "0 0 20px rgba(47,82,211,0.4), 0 4px 16px rgba(47,82,211,0.2)",
        "glow-roxo":    "0 0 20px rgba(123,36,199,0.4), 0 4px 16px rgba(123,36,199,0.2)",
        "glow-rosa":    "0 0 20px rgba(232,61,137,0.4), 0 4px 16px rgba(232,61,137,0.2)",
        "glow-dourado": "0 0 24px rgba(255,215,0,0.5),  0 4px 16px rgba(255,215,0,0.3)",
        "card-brand":   "0 4px 24px rgba(47,82,211,0.12)",
        "card-hover":   "0 8px 32px rgba(47,82,211,0.2)",
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },

      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },

      animation: {
        "fade-in":    "fadeIn 0.5s ease-in-out",
        "slide-up":   "slideUp 0.4s ease-out",
        "pulse-glow": "pulseGlow 2s infinite",
        "float":      "float 3s ease-in-out infinite",
        "shimmer":    "shimmer 2s linear infinite",
        "sparkle":    "sparkle 1.5s ease-in-out infinite",
      },

      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%":   { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)",    opacity: "1" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(47,82,211,0.4)" },
          "50%":      { boxShadow: "0 0 0 10px rgba(47,82,211,0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%":      { transform: "translateY(-8px)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% center" },
          "100%": { backgroundPosition:  "200% center" },
        },
        sparkle: {
          "0%, 100%": { opacity: "1",   transform: "scale(1)" },
          "50%":      { opacity: "0.6", transform: "scale(1.2)" },
        },
      },
    },
  },
  plugins: [animate, typography],
};

export default config;
