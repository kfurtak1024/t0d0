import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";

import { App, seed } from "./app";
import { load } from "./storage";
import { Store } from "./store";
import { applyTheme, loadTheme, watchSystemTheme } from "./theme";

// Before anything renders, so there is no flash of the wrong theme.
applyTheme(loadTheme());
watchSystemTheme(loadTheme);

/*
 * A throw during boot would otherwise leave a blank page with no explanation,
 * and the list is only in storage — so say what happened and where it still is.
 */
try {
  const store = new Store(load() ?? seed());
  new App(store).start();
} catch (error) {
  console.error(error);
  const note = document.createElement("p");
  note.className = "noscript";
  note.textContent =
    "t0d0 failed to start. Your list is still saved in this browser — try reloading.";
  document.body.replaceChildren(note);
}
