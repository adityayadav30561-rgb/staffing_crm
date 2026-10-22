import { Component, type ReactNode } from 'react';

/** Keeps one broken screen from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card mx-auto mt-40 max-w-[480px] p-24 text-center">
        <p className="title text-14">Something went wrong on this screen</p>
        <p className="mt-6 text-10 text-ink-3">{this.state.error.message}</p>
        <button className="mt-14 rounded-full bg-forest px-14 py-7 text-11 font-medium text-mint" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
