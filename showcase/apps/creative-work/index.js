// Creative Work: a selector window for posters, films and design pieces.
// Shows the "poster" carousel variant (tall frame), a logo in an image-fit
// frame, and link rows. Edit PIECES to add your own.

import { createCarousel, escapeHtml, mountSelectorWindow, selectorWindowBody } from "../../kit/index.js";

const PIECES = [
  {
    id: "creative-posters",
    title: "Poster Redesigns",
    description: "Print design.<br />2025",
    icon: "assets/app-icons/ico/paint_old.ico",
    summary: "Tall artwork uses the poster carousel variant, which gives the frame more height.",
    posters: [
      { src: "assets/creative-work/poster-1.svg", alt: "Placeholder poster one", title: "Magazine cover" },
      { src: "assets/creative-work/poster-2.svg", alt: "Placeholder poster two", title: "Watercolor" },
      { src: "assets/creative-work/poster-3.svg", alt: "Placeholder poster three", title: "Black and white" },
    ],
    links: [],
  },
  {
    id: "creative-brand",
    title: "Brand Identity",
    description: "Logo and wordmark.<br />2024",
    icon: "assets/app-icons/ico/directory_fonts_cool.ico",
    summary:
      "A single image sits in an image-fit frame: the frame adopts the picture's aspect ratio so the sunken border hugs it.",
    logo: { src: "assets/creative-work/logo.svg", alt: "Placeholder logo" },
    links: [{ label: "Case study", href: "https://example.com/brand" }],
  },
  {
    id: "creative-film",
    title: "Short Film",
    description: "Writing and acting.<br />2026",
    icon: "assets/app-icons/ico/camera3_vid.ico",
    summary: "Link rows hold trailers, festival pages or the full film; a poster carousel works here too.",
    posters: [{ src: "assets/creative-work/poster-2.svg", alt: "Film poster", title: "In production" }],
    links: [
      { label: "Watch the trailer", href: "https://example.com/trailer" },
      { label: "Festival page", href: "https://example.com/festival" },
    ],
  },
];

const linksHtml = (links) =>
  links.length
    ? `<div class="action-row">${links
        .map(
          (link) =>
            `<a class="button-link" href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`
        )
        .join("")}</div>`
    : "";

const viewHtml = (piece) => `
  <div class="view-header">
    <h3>${escapeHtml(piece.title)}</h3>
    <p class="view-subtitle">${piece.description.replace(/<br\s*\/?>/g, " · ")}</p>
  </div>
  ${linksHtml(piece.links)}
  <p>${escapeHtml(piece.summary)}</p>
  ${
    piece.logo
      ? `<div class="image-fit-frame creative-logo-frame" data-fit-image-frame>
           <div class="image-fit-slot"><img data-src="${escapeHtml(piece.logo.src)}" alt="${escapeHtml(piece.logo.alt)}" /></div>
         </div>`
      : ""
  }
  ${piece.posters ? `<div data-creative-carousel="${escapeHtml(piece.id)}"></div>` : ""}`;

export default {
  id: "creative-work",
  title: "Creative Work",
  label: "Creative",
  icon: "assets/app-icons/ico/paint_old.ico",
  styles: ["apps/creative-work/creative-work.css"],
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
      { listLabel: "Creative work" }
    ),
  mount({ window: win }) {
    mountSelectorWindow(win);
    for (const piece of PIECES) {
      const container = win.querySelector(`[data-creative-carousel="${piece.id}"]`);
      if (container) createCarousel(container, piece.posters, { variant: "poster", label: `${piece.title} artwork` });
    }
  },
};
