// About Me: a photo carousel beside an overview panel. Replace the copy,
// the photos in assets/about/ and the education list with your own.

import { createCarousel } from "../../kit/index.js";

const PHOTOS = [
  { src: "assets/about/photo-1.svg", alt: "Placeholder portrait one" },
  { src: "assets/about/photo-2.svg", alt: "Placeholder portrait two" },
  { src: "assets/about/photo-3.svg", alt: "Placeholder portrait three" },
];

export default {
  id: "about",
  title: "About Me",
  icon: "assets/app-icons/ico/help_book_big.ico",
  styles: ["apps/about/about.css"],
  window: {
    width: 640,
    className: "about-window",
    controls: ["help", "close"],
    center: true,
    dialog: true,
    bodyClassName: "about-body",
  },
  render: () => `
    <div class="about-page">
      <header class="about-page-header">
        <h2 class="about-title">Welcome to my desktop!</h2>
        <time class="about-date" data-about-date></time>
      </header>
      <div class="about-intro-grid">
        <section class="about-carousel-section" aria-labelledby="about-photo-heading">
          <h3 class="visually-hidden" id="about-photo-heading">Photo carousel</h3>
          <div data-about-carousel></div>
        </section>
        <aside class="about-overview-panel" aria-label="Overview">
          <section aria-labelledby="about-site-heading">
            <h3 id="about-site-heading">About this site</h3>
            <p>
              This desktop was built with the win98-site-kit. Every icon opens an app window;
              drag title bars, resize the corner of list windows, and click the clock for the calendar.
            </p>
          </section>
          <section aria-labelledby="about-education-heading">
            <h3 id="about-education-heading">Education</h3>
            <ul class="about-degrees">
              <li class="about-degree">
                <img src="assets/app-icons/ico/certificate_gear.ico" width="32" height="32" alt="" />
                <span><strong>B.S. Example Engineering</strong><br />Example University, 2026</span>
              </li>
              <li class="about-degree">
                <img src="assets/app-icons/ico/certificate_multiple.ico" width="32" height="32" alt="" />
                <span><strong>Minor in Something Fun</strong><br />Example University, 2026</span>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>`,
  mount({ window: win }) {
    createCarousel(win.querySelector("[data-about-carousel]"), PHOTOS, {
      variant: "photo",
      label: "About me photos",
    });
    const date = win.querySelector("[data-about-date]");
    const update = () => {
      const now = new Date();
      date.dateTime = now.toISOString().slice(0, 10);
      date.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    };
    update();
    window.setInterval(update, 60_000);
  },
  onHelp() {
    window.open("https://github.com/rohinshanker/win98-site-kit", "_blank", "noopener,noreferrer");
  },
};
