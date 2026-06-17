import type { HTMLAttributes } from "react";

import { cn } from "../lib";

export const Badge = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100",
      className
    )}
    {...props}
  />
);
