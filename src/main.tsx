import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main style={{ padding: "3rem", fontFamily: "system-ui" }}>
        <h1>PACKETLAB</h1>
        <p role="alert">
          Не удалось запустить лабораторию / The lab could not start.
        </p>
        <button onClick={() => window.location.reload()}>
          Перезагрузить / Reload
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
