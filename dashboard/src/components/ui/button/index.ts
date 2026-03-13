import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Button } from "./Button.vue"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:brightness-110 active:brightness-90 shadow-[var(--shadow-sm)]",
        destructive: "bg-destructive text-white hover:brightness-110 active:brightness-90 shadow-[var(--shadow-sm)]",
        outline: "border border-separator/70 bg-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-text-primary",
        secondary: "bg-bg-tertiary text-text-primary hover:brightness-[1.02] active:brightness-95",
        ghost: "hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-text-primary",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        "default": "h-8 px-3.5 py-1.5",
        "sm": "h-7 px-2.5 text-[12px]",
        "lg": "h-[34px] px-4",
        "icon": "h-8 w-8",
        "icon-sm": "size-7",
        "icon-lg": "size-[34px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
