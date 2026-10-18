// Socials: a list of links with icons. Edit LINKS.

import { escapeHtml } from "../../kit/index.js";

const LINKS = [
  { name: "GitHub", handle: "@your-handle", href: "https://github.com/", icon: "assets/app-icons/ico/gears.ico" },
  { name: "LinkedIn", handle: "@your-name", href: "https://www.linkedin.com/", icon: "assets/app-icons/ico/users_green.ico" },
  { name: "Email", handle: "you [at] example [dot] com", href: "mailto:you@example.com", icon: "assets/app-icons/ico/mailbox_world.ico" },
];

export default {
  id: "socials",
  title: "Socials",
  icon: "assets/app-icons/ico/connected_world.ico",
  window: { width: 360, controls: ["close"], dialog: true, bodyClassName: "socials-body" },
  render: () => `
    <p>Find me here:</p>
    <ul class="icon-list">
      ${LINKS.map(
        (link) => `
        <li>
          <a href="${escapeHtml(link.href)}"${link.href.startsWith("mailto:") ? "" : ' target="_blank" rel="noreferrer"'}>
            <img src="${escapeHtml(link.icon)}" alt="" />
            <span>
              <span class="icon-list-title">${escapeHtml(link.name)}</span>
              <span class="icon-list-subtitle">${escapeHtml(link.handle)}</span>
            </span>
          </a>
        </li>`
      ).join("")}
    </ul>`,
};
