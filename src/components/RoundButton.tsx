import type { ComponentProps } from "react";

/** Round glass button used by the corner bar and the zoom bar. */
export function RoundButton({ small, className, ...props }: { small?: boolean } & ComponentProps<"button">) {
  return (
    <button
      className={[
        "grid size-10.5 place-items-center rounded-[50%] border border-line bg-glass leading-none shadow-panel backdrop-blur-[14px]",
        "[transition:transform_0.15s_ease,background_0.2s] active:[transform:scale(0.92)] [&_svg]:size-5.5",
        "aria-expanded:border-ink aria-expanded:bg-ink aria-expanded:text-on-ink",
        small ? "text-[12px]" : "text-[20px]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
