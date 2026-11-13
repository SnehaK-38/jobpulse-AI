import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.jsx";

window.addEventListener("load", () => {
  const remember = localStorage.getItem("rememberMe") === "true";

  if (!remember) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }
});

import { BrowserRouter } from "react-router-dom";
import { SignupProvider } from "./context/SignupContext.jsx";


ReactDOM.createRoot(
  document.getElementById("root")
).render(

  <BrowserRouter>

    <SignupProvider>

      <App />

    </SignupProvider>

  </BrowserRouter>

);