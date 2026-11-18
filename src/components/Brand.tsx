export function Brand() {
  return (
    <header className="pointer-events-none fixed top-[calc(16px+var(--safe-t))] left-[calc(4px+var(--gutter-l))] wide:left-[calc(8px+var(--gutter-l))] short:top-[calc(10px+var(--safe-t))] roomy:top-7.5 roomy:left-[calc(20px+var(--gutter-l))]">
      <div className="font-logo text-[30px] leading-[1.1] tracking-[0.12em] text-ink-strong transition-[color] duration-300 ease-[ease] dim:text-white dim:[text-shadow:0_1px_12px_rgba(20,16,40,0.55)] short:text-[24px] roomy:text-[34px]">
        雨丝
      </div>
      <div className="mt-[3px] text-[10px] tracking-[0.32em] text-ink-soft transition-[color] duration-300 ease-[ease] dim:text-[#fffc] short:hidden">
        WET DENIER LAB
      </div>
    </header>
  );
}
