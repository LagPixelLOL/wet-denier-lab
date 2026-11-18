import { actions } from "../engine/app/actions";
import { useStore } from "../state/useStore";
import { ui } from "../state/ui";
import { CloseIcon } from "./icons";

export function AboutDialog() {
  const open = useStore(ui, (s) => s.panels.about);
  return (
    <section
      id="about"
      className="invisible fixed top-[calc(68px+var(--safe-t))] right-(--gutter-r) z-7 max-h-[calc(100vh-190px-var(--safe-t)-var(--safe-b))] w-[min(340px,calc(100vw-var(--gutter-l)-var(--gutter-r)))] [transform:translateY(-8px)] overflow-auto overscroll-contain rounded-[22px] border border-line bg-paper px-5 pt-5 pb-4 text-[13px] leading-[1.6] text-ink opacity-0 shadow-panel backdrop-blur-[20px] [transition:opacity_0.25s_ease,transform_0.25s_ease,visibility_0s_0.25s] supports-[max-height:100dvh]:max-h-[calc(100dvh-190px-var(--safe-t)-var(--safe-b))] about-open:visible about-open:[transform:none] about-open:opacity-100 about-open:[transition:opacity_0.25s_ease,transform_0.25s_ease] roomy:top-[84px] roomy:right-[calc(14px+var(--gutter-r))] roomy:max-h-[calc(100vh-210px)]"
      role="dialog"
      aria-label="制作说明"
      aria-hidden={!open}
    >
      <button
        id="aboutClose"
        className="absolute top-2.5 right-2.5 grid size-8.5 place-items-center rounded-[50%] text-ink-soft [&_svg]:size-5"
        aria-label="关闭说明"
        onClick={actions.closeAbout}
      >
        <CloseIcon />
      </button>
      <div className="pr-8.5">
        <div className="font-logo text-[34px] leading-none tracking-[0.12em] text-ink-strong">雨丝</div>
        <div className="mt-1.5 text-[12px] tracking-[0.08em] text-ink-soft">Wet Denier Lab · 丝袜泼水实验</div>
        <div className="mt-2.5 inline-flex items-baseline gap-2 rounded-[999px] bg-accent-soft px-3 py-[5px] text-[12px] tracking-[0.06em] text-ink-soft">
          制作 <strong className="text-[14px] tracking-[0.04em] text-ink-strong">Newton Quan</strong>
        </div>
      </div>
      <p className="mx-0 mt-3.5 mb-0 text-pretty text-ink">
        点丝袜泼水，看水花炸开、湿处透出皮肤、水珠挂住滑落。底栏切换泼水和视角；「场景」里换地方，「衣橱」里换姿势、款式、材质和花纹，每种料子遇水的样子都不一样。
      </p>
      <dl className="mx-0 mt-3.5 mb-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="pt-px text-[11px] tracking-[0.16em] text-accent-deep">技术</dt>
        <dd className="m-0 text-ink-soft">Three.js 实时渲染，丝袜、水、场景和声音都由程序实时生成，没有用一张图片</dd>
        <dt className="pt-px text-[11px] tracking-[0.16em] text-accent-deep">素材</dt>
        <dd className="m-0 text-ink-soft">
          腿型 MakeHuman（CC0）· 丝袜原型 punkduck（
          <a
            className="text-accent-deep underline-offset-2"
            href="https://creativecommons.org/licenses/by/3.0/"
            target="_blank"
            rel="noopener"
          >
            CC BY 3.0
          </a>
          ，已改编）· Three.js（MIT）
        </dd>
      </dl>
      <div className="mt-4 border-t border-t-hairline pt-3 text-[11px] tracking-[0.14em] text-ink-soft">
        © 2026 Newton Quan
      </div>
    </section>
  );
}
