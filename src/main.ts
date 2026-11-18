import { backend } from "./api";
import { startApp } from "./app";

// A failure to start must be seen: the real-shell suite fails on any console
// error, so a rejected first load cannot pass unnoticed.
window.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector<HTMLElement>("#app");
  if (root) startApp(root, backend).catch((error: unknown) => console.error(error));
});
