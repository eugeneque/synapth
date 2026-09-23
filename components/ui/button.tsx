import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* Buttons — design.md §6. One `default` (signal) per viewport; everything else is outline / ghost / mono. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-synapse text-synapse-foreground shadow-glow hover:-translate-y-px hover:shadow-glow-lg hover:brightness-105",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        outline: "border border-border bg-transparent hover:border-foreground/40 hover:bg-accent/60",
        /* Recessed mono action: `[RUN CRAWL]`, `EXPORT` … */
        mono: "border border-border bg-muted font-mono text-[11px] uppercase tracking-[0.14em] text-foreground hover:bg-accent hover:border-foreground/30",
        ghost: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        destructive: "border border-danger/30 bg-transparent text-danger hover:bg-danger/10",
        link: "text-synapse underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 font-mono text-xs uppercase tracking-[0.14em]",
        /* Display CTA: Inter 600 18px, like the hero "Explore Registry" button. */
        hero: "h-12 px-8 text-base font-semibold tracking-tight",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
