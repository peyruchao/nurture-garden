import "./alchemy.css";
import { App } from "./app/AlchemySandboxApp";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Application root not found.");

let viewportFrame = 0;
const syncVisibleViewport = () => {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    const viewport = window.visualViewport;
    root.style.setProperty("--app-viewport-left", `${viewport?.offsetLeft ?? 0}px`);
    root.style.setProperty("--app-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    root.style.setProperty("--app-viewport-width", `${viewport?.width ?? window.innerWidth}px`);
    root.style.setProperty("--app-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
  });
};

syncVisibleViewport();
window.addEventListener("resize", syncVisibleViewport);
window.addEventListener("orientationchange", syncVisibleViewport);
window.addEventListener("pageshow", syncVisibleViewport);
window.visualViewport?.addEventListener("resize", syncVisibleViewport);
window.visualViewport?.addEventListener("scroll", syncVisibleViewport);

new App(root);
