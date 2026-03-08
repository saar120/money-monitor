import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Button } from "./Button.vue"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground active:brightness-90",
        destructive: "bg-destructive text-white active:brightness-90",
        outline: "border border-separator bg-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-text-primary",
        secondary: "bg-bg-tertiary text-text-primary active:brightness-95",
        ghost: "hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-text-primary",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        "default": "h-7 px-3 py-1",
        "sm": "h-[22px] px-2 text-[12px]",
        "lg": "h-[34px] px-4",
        "icon": "h-7 w-7",
        "icon-sm": "size-[22px]",
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
