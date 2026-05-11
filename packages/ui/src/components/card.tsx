import type { HTMLAttributes } from "react";

import { cn } from "../lib";

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 text-slate-950 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.35)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 sm:rounded-[28px] sm:p-6",
      className
    )}
    {...props}
  />
);

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-lg font-semibold tracking-tight text-slate-950 dark:text-slate-50", className)} {...props} />
);

export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-sm leading-6 text-slate-900 dark:text-slate-100", className)} {...props} />
);
