import type { Config } from "tailwindcss";

export default {
	content: ["./app/**/{**,.client,.server}/**/*.{js,jsx,ts,tsx}"],
	theme: {
		extend: {
			keyframes: {
				"loading-bar-fill": {
					"0%": { transform: "scaleX(0)" },
					"100%": { transform: "scaleX(1)" },
				},
			},
			animation: {
				"loading-bar-fill":
					"loading-bar-fill 2.25s cubic-bezier(0.45, 0, 0.55, 1) infinite",
			},
			fontFamily: {
				sans: ["Space Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
				outfit: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
			},
			colors: {
				border: "hsl(var(--border))",
				input: "hsl(var(--input))",
				ring: "hsl(var(--ring))",
				background: "hsl(var(--background))",
				foreground: "hsl(var(--foreground))",
				primary: {
					DEFAULT: "hsl(var(--primary))",
					foreground: "hsl(var(--primary-foreground))",
				},
				secondary: {
					DEFAULT: "hsl(var(--secondary))",
					foreground: "hsl(var(--primary-foreground))",
				},
				muted: {
					DEFAULT: "hsl(var(--muted))",
					foreground: "hsl(var(--muted-foreground))",
				},
				accent: {
					DEFAULT: "hsl(var(--accent))",
					foreground: "hsl(var(--primary-foreground))",
				},
			},
			borderRadius: {
				lg: "var(--radius)",
				md: "calc(var(--radius) - 2px)",
				sm: "calc(var(--radius) - 4px)",
			},
		},
	},
	plugins: [],
} satisfies Config;
