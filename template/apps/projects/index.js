// Projects: a selector window (list on the left, viewer on the right) with
// one carousel per project. Edit PROJECTS to add your own; each entry is one
// list row and one viewer page.

import { createCarousel, mountSelectorWindow, selectorWindowBody } from "../../kit/index.js";

const PROJECTS = [
  {
    id: "project-one",
    title: "Example Project",
    description: "Hardware and firmware.<br />Spring 2026",
    icon: "assets/app-icons/ico/expansion_board_modem.ico",
    links: [{ label: "Open project website", href: "https://example.com", primary: true }],
    summary: "A short paragraph about what the project does and why it mattered.",
    media: [
      { src: "assets/projects/sample-1.svg", title: "Overview", description: "The first slide." },
      { src: "assets/projects/sample-2.svg", title: "Detail", description: "The second slide." },
    ],
  },
  {
    id: "project-two",
    title: "Second Project",
    description: "Simulation and analysis.<br />Fall 2025",
    icon: "assets/app-icons/ico/network_three_pcs.ico",
    links: [],
    summary: "Carousels accept images and videos; drop files in assets/projects/ and list them here.",
    media: [
      { src: "assets/projects/sample-2.svg", title: "Result", description: "A result figure." },
      { src: "assets/projects/sample-1.svg", title: "Setup", description: "The setup." },
    ],
  },
];

const viewHtml = (project) => `
  <div class="view-header">
    <h3>${project.title}</h3>
    <p class="view-subtitle">${project.description.replace(/<br\s*\/?>/g, " · ")}</p>
  </div>
  ${
    project.links.length
      ? `<div class="action-row">${project.links
          .map(
            (link) =>
              `<a class="button-link" href="${link.href}" target="_blank" rel="noreferrer">${link.label}</a>`
          )
          .join("")}</div>`
      : ""
  }
  <p>${project.summary}</p>
  <div data-project-carousel="${project.id}"></div>`;

export default {
  id: "projects",
  title: "Projects",
  icon: "assets/app-icons/ico/regedit.ico",
  window: {
    className: "selector-window",
    controls: ["minimize", "maximize", "close"],
    resizable: true,
  },
  render: () =>
    selectorWindowBody(
      PROJECTS.map((project) => ({
        id: project.id,
        title: project.title,
        description: project.description,
        icon: project.icon,
        html: viewHtml(project),
      })),
      { listLabel: "Projects" }
    ),
  mount({ window: win }) {
    mountSelectorWindow(win);
    for (const project of PROJECTS) {
      createCarousel(win.querySelector(`[data-project-carousel="${project.id}"]`), project.media, {
        variant: "pdf",
        label: `${project.title} media`,
      });
    }
  },
};
