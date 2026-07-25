import { render } from "preact";
import "./index.css";
import "./app.css";
import "./marketing.css";
import { App } from "./app.tsx";
import { AuthProvider } from "./context/auth";
import { ToastProvider } from "./context/toast";
import { RouterProvider } from "./router";

render(
  <RouterProvider>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </RouterProvider>,
  document.getElementById("app")!,
);
