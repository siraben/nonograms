import React from "react";

type State = { error: Error | null };

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "monospace" }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: "pre-wrap", color: "#c0392b" }}>
            {this.state.error.message}
          </pre>
          <button onClick={() => { this.setState({ error: null }); location.hash = "/"; }}>
            Go home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
