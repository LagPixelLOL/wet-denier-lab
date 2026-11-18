import type { ComponentProps } from "react";

type PillStyle = {
  /** Accent gradient fill. */
  solid?: boolean;
  /** Bigger padding and text, as in the photo dialog. */
  large?: boolean;
};

const pillClass = ({ solid, large }: PillStyle, className?: string) =>
  [
    "inline-flex items-center justify-center whitespace-nowrap rounded-[999px] border no-underline",
    "[transition:transform_0.12s,background_0.2s] active:[transform:scale(0.95)] hidden-attr:hidden",
    large ? "px-5 py-2.5 text-[13.5px]" : "px-3.5 py-[7px] text-[12.5px]",
    solid
      ? "border-transparent bg-[linear-gradient(160deg,var(--accent),var(--accent-deep))] text-on-ink shadow-[0_6px_16px_var(--focus)]"
      : "border-hairline bg-chip text-ink",
    className,
  ]
    .filter(Boolean)
    .join(" ");

export function Pill({ solid, large, className, ...props }: PillStyle & ComponentProps<"button">) {
  return <button className={pillClass({ solid, large }, className)} {...props} />;
}

export function PillLink({ solid, large, className, ...props }: PillStyle & ComponentProps<"a">) {
  return <a className={pillClass({ solid, large }, className)} {...props} />;
}
