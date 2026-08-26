import React from "react";

/**
 * Without this, a render error blanks the page and the user sees nothing at all
 * — which is exactly how the first version failed. An error you can read is
 * worth more than a layout you cannot.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[shoal] render error", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="axis" style={{ paddingTop: 80 }}>
        <p className="tick">Something broke</p>
        <h2>The page failed to render.</h2>
        <p className="status error mono">{String(this.state.error?.message ?? this.state.error)}</p>
        <p className="note">
          The full stack is in the browser console. Please send it over — a silent failure is a bug
          in this page, not in your wallet.
        </p>
      </div>
    );
  }
}
