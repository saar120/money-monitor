import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

export const badgeVariants = cva(
  "inline-flex gap-1 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring/30",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary/15 text-primary",
        secondary:
          "border-transparent bg-bg-tertiary text-text-secondary",
        destructive:
          "border-transparent bg-destructive/15 text-destructive",
        outline: "text-text-primary border-separator",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export type BadgeVariants = VariantProps<typeof badgeVariants>
