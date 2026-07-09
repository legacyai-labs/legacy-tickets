import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

marked.setOptions({ gfm: true, breaks: true });

// marked v14 does NOT strip raw HTML, and ticket bodies can come from the API
// (MCP / Autopilot). So we sanitize the rendered HTML before it is injected in
// the board — no <script>, no event handlers, no javascript: URLs.
const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "ul", "ol", "li", "blockquote",
    "code", "pre", "em", "strong", "del", "hr", "br", "img", "span",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title"],
    code: ["class"],
    span: ["class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
  },
};

/** Render markdown to SANITIZED HTML safe for dangerouslySetInnerHTML. */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md || "", { async: false }) as string;
  return sanitizeHtml(html, SANITIZE);
}
