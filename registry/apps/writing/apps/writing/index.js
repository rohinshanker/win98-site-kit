// Writing: a selector window listing essays, papers and talks. Each entry
// has a summary, optional links (a PDF, a published page) and an optional
// slide carousel. Edit PIECES to add your own.

import { createCarousel, escapeHtml, mountSelectorWindow, selectorWindowBody } from "../../kit/index.js";

const PIECES = [
  {
    id: "writing-sample-paper",
    title: "Sample Research Paper",
    description: "Journal article.<br />2026",
    icon: "assets/app-icons/ico/document.ico",
    links: [{ label: "Read the paper", href: "https://example.com/paper.pdf" }],
    summary:
      "Replace this with the abstract or a short pitch. Links open in a new tab; slides below are optional.",
    slides: [
      { src: "assets/writing/sample-slide-1.svg", title: "Slide 4", description: "A figure from the talk." },
      { src: "assets/writing/sample-slide-2.svg", title: "Slide 5", description: "The results slide." },
    ],
  },
  {
    id: "writing-sample-essay",
    title: "Sample Essay",
    description: "Personal essay.<br />2025",
    icon: "assets/app-icons/ico/notepad.ico",
    links: [{ label: "Read on the web", href: "https://example.com/essay" }],
    summary: "An entry without slides shows only its summary and links.",
    slides: [],
  },
];

const viewHtml = (piece) => `
  <div class="view-header">
    <h3>${escapeHtml(piece.title)}</h3>
    <p class="view-subtitle">${piece.description.replace(/<br\s*\/?>/g, " · ")}</p>
  </div>
  ${
    piece.links.length
      ? `<div class="action-row">${piece.links
          .map(
            (link) =>
              `<a class="button-link" href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`
          )
          .join("")}</div>`
      : ""
  }
  <p>${escapeHtml(piece.summary)}</p>
  ${piece.slides.length ? `<div data-writing-carousel="${escapeHtml(piece.id)}"></div>` : ""}`;

export default {
  id: "writing",
  title: "Writing",
  icon: "assets/app-icons/ico/shell_window6.ico",
  window: {
    className: "selector-window",
    controls: ["minimize", "maximize", "close"],
    resizable: true,
  },
  render: () =>
    selectorWindowBody(
      PIECES.map((piece) => ({
        id: piece.id,
        title: piece.title,
        description: piece.description,
        icon: piece.icon,
        html: viewHtml(piece),
      })),
      { listLabel: "Writing" }
    ),
  mount({ window: win }) {
    mountSelectorWindow(win);
    for (const piece of PIECES) {
      const container = win.querySelector(`[data-writing-carousel="${piece.id}"]`);
      if (container) createCarousel(container, piece.slides, { variant: "pdf", label: `${piece.title} slides` });
    }
  },
};
