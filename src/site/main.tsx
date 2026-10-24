import React from "react";
import ReactDOM from "react-dom/client";
import { Website } from "./website";
import "../index.css";
document.body.classList.add("site-body");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Website />
  </React.StrictMode>,
);
