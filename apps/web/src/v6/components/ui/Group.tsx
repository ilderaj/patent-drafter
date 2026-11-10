import React from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface GroupProps {
  children: ReactNode;
  /** Prototype modifier: full-bleed inside a page. */
  flat?: boolean;
  className?: string;
}

export function Group({ children, flat = false, className = "" }: GroupProps) {
  return <div className={`group${flat ? " flat" : ""} ${className}`.trim()}>{children}</div>;
}

export interface RowProps {
  title?: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  /** Row modifiers: `click`, `sel`, `sep`. */
  clickable?: boolean;
  selected?: boolean;
  separator?: boolean;
  className?: string;
  /** Optional router link around the row content. */
  to?: string;
  onClick?: () => void;
}

export function Row({ title, description, right, children, clickable = false, selected = false, separator = false, className = "", to, onClick }: RowProps) {
  const classes = ["row", clickable || to !== undefined || onClick !== undefined ? "click" : "", selected ? "sel" : "", separator ? "sep" : "", className].filter(Boolean).join(" ");
  const main = children ?? <div className="r-main">
    {title !== undefined ? <div className="r-title">{title}</div> : null}
    {description !== undefined ? <div className="r-sub">{description}</div> : null}
  </div>;
  const content = <>{main}{right !== undefined ? <div className="r-right">{right}</div> : null}</>;
  if (to !== undefined) return <Link to={to} className={classes}>{content}</Link>;
  if (onClick !== undefined) return <button type="button" className={classes} onClick={onClick}>{content}</button>;
  return <div className={classes}>{content}</div>;
}
