import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, ArrowLeft } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center bg-gray-950 p-6 text-center">
          <div className="max-w-md p-6 bg-gray-900 border border-red-700/60 rounded-2xl shadow-2xl space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-950/80 border border-red-500/50 flex items-center justify-center text-red-400">
              <AlertTriangle size={24} />
            </div>
            <h3 className="text-lg font-bold text-white">
              {this.props.fallbackTitle || 'Ein Fehler ist aufgetreten'}
            </h3>
            <p className="text-xs text-red-300 font-mono bg-red-950/40 p-2.5 rounded-lg border border-red-900/40 text-left overflow-x-auto">
              {this.state.error?.message || 'Unbekannter Fehler'}
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              {this.props.onReset && (
                <button
                  onClick={() => {
                    this.setState({ hasError: false, error: null });
                    this.props.onReset?.();
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
                >
                  <ArrowLeft size={14} />
                  <span>Zurück zum Editor</span>
                </button>
              )}
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
              >
                <RotateCcw size={14} />
                <span>Erneut versuchen</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
