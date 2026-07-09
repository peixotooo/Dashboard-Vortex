import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-muted [background:linear-gradient(100deg,var(--muted)_40%,color-mix(in_srgb,var(--muted-foreground)_12%,var(--muted))_50%,var(--muted)_60%)_0_0/200%_100%] [animation:shimmer_1.8s_ease-in-out_infinite]",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
