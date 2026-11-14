import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { register } from "tsx/esm/api";

register();
const { ErrorBoundary } = await import("../../../../apps/web/src/v6/components/ErrorBoundary.tsx");

function renderBoundary(boundary) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, boundary.render()));
}

test("a healthy boundary renders its children unchanged", () => {
  const boundary = new ErrorBoundary({ children: createElement("span", null, "正常内容"), area: "页面" });
  assert.equal(renderBoundary(boundary), "<span>正常内容</span>");
});

test("the fallback names the area, keeps retry/matters links and hides details behind a disclosure", () => {
  const boundary = new ErrorBoundary({ children: null, area: "自助步骤" });
  boundary.state = {
    error: Object.assign(new Error("渲染失败示例"), { stack: "错误栈示例" }),
    componentStack: "\n 于 SelfService",
  };
  const html = renderBoundary(boundary);
  assert.match(html, /自助步骤暂时无法显示/);
  assert.match(html, /已保存的案件数据仍在本机/);
  assert.match(html, /重试/);
  assert.match(html, /返回案件列表/);
  assert.match(html, /href="\/v6\/matters"/);
  assert.match(html, /<details/);
  assert.match(html, /技术详情/);
  assert.match(html, /渲染失败示例/);
  assert.match(html, /错误栈示例/);
  assert.match(html, /组件栈：/);
});

test("getDerivedStateFromError records the thrown error instead of discarding it", () => {
  const error = new Error("boom");
  assert.equal(ErrorBoundary.getDerivedStateFromError(error).error, error);
});
