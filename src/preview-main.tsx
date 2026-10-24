import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <>
      <a
        className="demo-home-link"
        href={import.meta.env.BASE_URL}
        aria-label="Anser home"
      >
        ← Anser
      </a>
      <App />
    </>
  </React.StrictMode>,
);
