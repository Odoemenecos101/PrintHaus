import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'An unexpected application error occurred.';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed.error === 'string') {
        readable = parsed.error;
      }
    } catch {
      // Non-JSON error message
    }
    return { hasError: true, errorMessage: readable };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('PrintHaus ErrorBoundary caught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
            <p className="text-sm text-slate-600 leading-relaxed">{this.state.errorMessage}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 py-2 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload PrintHaus</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
