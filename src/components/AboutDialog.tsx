import { CloseIcon } from "./icons";

export function AboutDialog() {
  return (
    <section id="about" className="about" role="dialog" aria-label="制作说明" aria-hidden="true">
      <button id="aboutClose" className="close" aria-label="关闭说明">
        <CloseIcon />
      </button>
      <div className="about-head">
        <div className="about-logo">雨丝</div>
        <div className="about-name">Wet Denier Lab · 丝袜泼水实验</div>
        <div className="maker">
          制作 <strong>Newton Quan</strong>
        </div>
      </div>
      <p className="lead">
        点丝袜泼水，看水花炸开、湿处透出皮肤、水珠挂住滑落。底栏切换泼水和视角；「场景」里换地方，「衣橱」里换姿势、款式、材质和花纹，每种料子遇水的样子都不一样。
      </p>
      <dl className="facts">
        <dt>技术</dt>
        <dd>Three.js 实时渲染，丝袜、水、场景和声音都由程序实时生成，没有用一张图片</dd>
        <dt>素材</dt>
        <dd>
          腿型 MakeHuman（CC0）· 丝袜原型 punkduck（
          <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">
            CC BY 3.0
          </a>
          ，已改编）· Three.js（MIT）
        </dd>
      </dl>
      <div className="about-foot">© 2026 Newton Quan</div>
    </section>
  );
}
