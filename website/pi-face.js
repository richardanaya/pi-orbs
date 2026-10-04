const PI_FACE_MARKUP = `
<style>
  :host {
    --orb: #d7e0e6;
    --ink: #07313a;
    display: grid;
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 50%;
    background:
      radial-gradient(circle at 92% 96%, color-mix(in srgb, var(--orb) 42%, #4a5559) 0%, color-mix(in srgb, var(--orb) 74%, #8b9598) 28%, transparent 52%),
      radial-gradient(circle at 32% 26%, color-mix(in srgb, var(--orb) 10%, white) 0%, transparent 42%),
      var(--orb);
    filter: drop-shadow(0 10px 8px rgba(40, 24, 22, 0.16));
    animation: orb-hop 2.2s ease-in-out infinite;
  }
  :host([hidden]) { display: none; }
  :host([tone="0"]) { --orb: #d5e2ea; }
  :host([tone="1"]) { --orb: #e7ddd2; }
  :host([tone="2"]) { --orb: #dce8df; }
  :host([look="slate"]) { --orb: #c5d0dc; }
  :host([look="silver"]) { --orb: #e7e2d6; }
  :host([look="mist"]) { --orb: #c5dff6; }
  :host([look="tide"]) { --orb: #b7e6de; }
  :host([look="pine"]) { --orb: #c6e8b4; }
  :host([look="amber"]) { --orb: #f6d59a; }
  :host([look="clay"]) { --orb: #f6c4b6; }
  :host([look="plum"]) { --orb: #e0c6ef; }
  svg { width: 100%; height: 100%; display: block; overflow: visible; }
  .pi-eyes > ellipse { fill: var(--ink); }
  .pi-mark { fill: var(--ink); }
  .pi-eyes { transform-box: fill-box; transform-origin: center; animation: pi-blink 5.4s ease-in-out infinite; }
  .pi-blush { transform-box: fill-box; transform-origin: center; animation: pi-blush 4.2s ease-in-out infinite; }
  @keyframes orb-hop {
    0%, 6%, 100% { transform: translateY(0); }
    1.4% { transform: translateY(1.5%); }
    3.2% { transform: translateY(-6%); }
    5% { transform: translateY(0); }
  }
  @keyframes pi-blink {
    0%, 46%, 50%, 92%, 100% { transform: scaleY(1); }
    48%, 94% { transform: scaleY(0.12); }
  }
  @keyframes pi-blush {
    0%, 100% { opacity: 0.8; }
    50% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    :host, .pi-eyes, .pi-blush { animation: none; }
  }
</style>
<svg viewBox="0 0 40 40" aria-hidden="true">
  <g class="pi-look">
    <g class="pi-shell" transform="translate(20 17)">
    <g class="pi-depth">
    <g transform="translate(-20 -17)">
    <g class="pi-blush">
      <ellipse cx="7.35" cy="19.85" rx="2.45" ry="1.45" fill="#e4a8ae"/>
      <ellipse cx="32.65" cy="19.85" rx="2.45" ry="1.45" fill="#e4a8ae"/>
    </g>
    <path class="pi-mark" d="M16.06 15.54 L15.97 15.73 L15.93 15.90 L15.93 16.08 L15.97 16.25 L16.06 16.41 L16.17 16.48 L16.30 16.46 L16.46 16.35 L16.65 16.14 L16.86 15.98 L17.08 15.86 L17.33 15.78 L17.60 15.74 L17.77 15.85 L17.85 16.11 L17.82 16.53 L17.70 17.10 L17.50 17.66 L17.25 18.20 L16.92 18.73 L16.52 19.24 L16.23 19.67 L16.03 20.03 L15.93 20.31 L15.93 20.51 L15.95 20.69 L16.00 20.85 L16.06 20.97 L16.14 21.08 L16.23 21.16 L16.34 21.23 L16.45 21.29 L16.58 21.33 L16.72 21.33 L16.89 21.29 L17.07 21.21 L17.28 21.09 L17.48 20.90 L17.67 20.64 L17.84 20.32 L18.01 19.93 L18.18 19.41 L18.37 18.76 L18.57 17.97 L18.78 17.05 L19.05 16.37 L19.38 15.94 L19.77 15.74 L20.23 15.78 L20.52 16.04 L20.66 16.52 L20.63 17.22 L20.45 18.14 L20.33 18.94 L20.29 19.62 L20.32 20.19 L20.43 20.64 L20.56 21.00 L20.71 21.27 L20.89 21.46 L21.10 21.57 L21.32 21.64 L21.55 21.69 L21.78 21.72 L22.03 21.72 L22.29 21.68 L22.55 21.60 L22.81 21.47 L23.08 21.31 L23.32 21.11 L23.53 20.86 L23.70 20.57 L23.85 20.25 L23.94 20.00 L23.97 19.82 L23.94 19.73 L23.86 19.71 L23.71 19.75 L23.49 19.85 L23.21 20.01 L22.85 20.24 L22.55 20.38 L22.29 20.44 L22.07 20.42 L21.91 20.32 L21.77 20.17 L21.65 19.98 L21.57 19.74 L21.50 19.45 L21.50 19.04 L21.57 18.51 L21.69 17.86 L21.88 17.08 L22.10 16.50 L22.36 16.11 L22.66 15.92 L22.99 15.92 L23.26 15.90 L23.47 15.86 L23.61 15.80 L23.69 15.72 L23.74 15.60 L23.75 15.46 L23.72 15.29 L23.66 15.08 L23.24 14.91 L22.46 14.77 L21.33 14.65 L19.83 14.57 L18.63 14.56 L17.70 14.62 L17.06 14.76 L16.71 14.96 L16.43 15.16 L16.21 15.35 Z"/>
    <g class="pi-eyes">
      <ellipse cx="9.4" cy="15.5" rx="2.05" ry="2.05"/>
      <ellipse cx="30.6" cy="15.5" rx="2.05" ry="2.05"/>
    </g>
    </g></g></g>
  </g>
</svg>`;
class PiFace extends HTMLElement {
  static observedAttributes = ["look", "name", "lively"];
  #motion = null;
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = PI_FACE_MARKUP;
  }
  connectedCallback() { this.#pace(); }
  attributeChangedCallback() { if (this.shadowRoot) this.#pace(); }
  #motionPattern() {
    if (this.#motion) return this.#motion;
    const span = (min, max) => min + Math.random() * (max - min);
    const reach = span(4.2, 6.2);
    const first = Math.random() < 0.5 ? -reach : reach;
    const second = -first * span(0.72, 1);
    const arc = (x) => -Math.min(1.15, (x * x) / 28);
    const scale = (x) => (1 - Math.min(0.12, Math.abs(x) / 55)).toFixed(3);
    const dur = span(7.5, 12);
    const side = (x) => `${x.toFixed(2)} ${arc(x).toFixed(2)}`;
    this.#motion = {
      dur: dur.toFixed(2),
      begin: span(0, dur).toFixed(2),
      values: ["0 0", "0 0", side(first), side(first), "0 0", "0 0", side(second), side(second), "0 0"].join(";"),
      scales: ["1", "1", scale(first), scale(first), "1", "1", scale(second), scale(second), "1"].join(";"),
      keyTimes: "0;0.06;0.16;0.48;0.58;0.64;0.74;0.92;1",
      blink: `${span(4.2, 7.4).toFixed(2)}s`,
      blinkDelay: `${span(0, 5).toFixed(2)}s`,
      blush: `${span(3.2, 5.8).toFixed(2)}s`,
      blushDelay: `${span(0, 3).toFixed(2)}s`,
      floatDelay: `${span(0, 14).toFixed(2)}s`,
      hop: `${span(14, 22).toFixed(2)}s`,
    };
    return this.#motion;
  }
  #pace() {
    const motion = this.#motionPattern();
    this.style.animationDelay = motion.floatDelay;
    this.style.animationDuration = motion.hop;
    const look = this.shadowRoot.querySelector(".pi-look");
    const depth = this.shadowRoot.querySelector(".pi-depth");
    const eyes = this.shadowRoot.querySelector(".pi-eyes");
    const blush = this.shadowRoot.querySelector(".pi-blush");
    if (look && !look.querySelector("animateTransform") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const anim = document.createElementNS("http://www.w3.org/2000/svg", "animateTransform");
      anim.setAttribute("attributeName", "transform");
      anim.setAttribute("type", "translate");
      anim.setAttribute("dur", `${motion.dur}s`);
      anim.setAttribute("repeatCount", "indefinite");
      anim.setAttribute("begin", `${motion.begin}s`);
      anim.setAttribute("calcMode", "spline");
      anim.setAttribute("values", motion.values);
      anim.setAttribute("keyTimes", motion.keyTimes);
      anim.setAttribute("keySplines", "0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1");
      look.append(anim);
      const squash = document.createElementNS("http://www.w3.org/2000/svg", "animateTransform");
      squash.setAttribute("attributeName", "transform");
      squash.setAttribute("type", "scale");
      squash.setAttribute("dur", `${motion.dur}s`);
      squash.setAttribute("repeatCount", "indefinite");
      squash.setAttribute("begin", `${motion.begin}s`);
      squash.setAttribute("calcMode", "spline");
      squash.setAttribute("values", motion.scales);
      squash.setAttribute("keyTimes", motion.keyTimes);
      squash.setAttribute("keySplines", "0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1;0.45 0 0.2 1");
      depth.append(squash);
    }
    if (eyes) {
      eyes.style.animationDuration = motion.blink;
      eyes.style.animationDelay = motion.blinkDelay;
    }
    if (blush) {
      blush.style.animationDuration = motion.blush;
      blush.style.animationDelay = motion.blushDelay;
    }
  }
}
customElements.define("pi-face", PiFace);
