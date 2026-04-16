import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/renderer/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        mist: "#eff6ff",
        calm: "#0f766e"
      },
      fontFamily: {
        sans: ["\"Segoe UI Variable Text\"", "\"Bahnschrift\"", "sans-serif"]
      },
      boxShadow: {
        glow: "0 20px 50px -24px rgba(15, 118, 110, 0.45)"
      }
    }
  },
  plugins: []
};

export default config;
