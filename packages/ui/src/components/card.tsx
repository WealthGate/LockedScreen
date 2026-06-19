import type { HTMLAttributes } from "react";

import { cn } from "../lib";

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "min-w-0 max-w-full rounded-[28px] border border-slate-200 bg-white p-4 text-slate-950 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.35)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 sm:p-6",
      className
    )}
    {...props}
  />
);

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("min-w-0 break-words text-lg font-semibold tracking-tight text-slate-950 dark:text-slate-50", className)} {...props} />
);

export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("min-w-0 break-words text-sm leading-6 text-slate-900 dark:text-slate-100", className)} {...props} />
);
