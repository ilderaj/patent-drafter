/**
 * Render-failure boundary for the `/v6` page area and each self-service step.
 *
 * A render error must not blank the whole app: the fallback keeps the shell,
 * says in plain Chinese what happened, offers a retry and a way back to the
 * matter list, and keeps the technical detail behind a disclosure. The error is
 * still reported to the console (`componentDidCatch`), so it is never swallowed.
 */
import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { v6Path } from "../routes/navigation.ts";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Human-readable area name, e.g. 「自助步骤」. */
  area?: string;
  /** Changing this value clears a previous error (e.g. on route or step change). */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the console record: the fallback must never hide the real failure.
    console.error(`[v6] ${this.props.area ?? "页面"}渲染出错`, error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null, componentStack: null });
    }
  }

  private retry = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (error === null) return this.props.children;
    return (
      <section className="v6-page" role="alert" data-testid="error-boundary" data-area={this.props.area ?? "页面"}>
        <div className="notice" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <strong>{this.props.area ?? "这个页面"}暂时无法显示</strong>
          <p>渲染时发生错误。已保存的案件数据仍在本机，不会因为这次错误丢失。</p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" data-testid="error-boundary-retry" onClick={this.retry}>
              重试
            </button>
            <Link className="btn btn-outline btn-sm" to={v6Path({ kind: "matters" })} data-testid="error-boundary-matters">
              返回案件列表
            </Link>
          </div>
          <details data-testid="error-boundary-details">
            <summary>技术详情</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
              {componentStack ? `\n\n组件栈：${componentStack}` : ""}
            </pre>
          </details>
        </div>
      </section>
    );
  }
}
