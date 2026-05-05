import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        border: "#e5e7eb",
        input: "#e5e7eb",
        ring: "#9ca3af",
        background: "#ffffff",
        foreground: "#111827",
        primary: {
          DEFAULT: "#111827",
          foreground: "#ffffff"
        },
        secondary: {
          DEFAULT: "#f3f4f6",
          foreground: "#111827"
        },
        muted: {
          DEFAULT: "#f9fafb",
          foreground: "#6b7280"
        }
      }
    }
  },
  plugins: []
};

export default config;
