import type { HTMLAttributes } from "react";

import { cn } from "../lib";

export const Badge = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      "inline-flex min-w-0 max-w-full items-center whitespace-normal break-words rounded-full bg-slate-100 px-3 py-1 text-center text-xs font-medium leading-4 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
      className
    )}
    {...props}
  />
);
