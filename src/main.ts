import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";

import { App, seed } from "./app";
import { load } from "./storage";
import { Store } from "./store";

const store = new Store(load() ?? seed());
new App(store).start();
