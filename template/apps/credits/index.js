// Credits for the bundled third-party work. Keep these lines when you reuse
// the assets; add your own below.

export default {
  id: "credits",
  title: "Credits",
  icon: "assets/app-icons/ico/search_laptop_1.ico",
  window: { width: 420, controls: ["minimize", "maximize", "close"] },
  render: () => `
    <ul class="icon-list">
      <li class="icon-list-row">
        <img src="assets/app-icons/ico/windows.ico" alt="" />
        <span>Windows icons from <a href="https://win98icons.alexmeub.com/" target="_blank" rel="noreferrer">win98icons.alexmeub.com</a></span>
      </li>
      <li class="icon-list-row">
        <img src="assets/app-icons/ico/computer.ico" alt="" />
        <span>CSS styling by <a href="https://github.com/jdan/98.css" target="_blank" rel="noreferrer">github.com/jdan/98.css</a></span>
      </li>
      <li class="icon-list-row">
        <img src="assets/app-icons/ico/world.ico" alt="" />
        <span>Desktop kit by <a href="https://github.com/rohinshanker/win98-site-kit" target="_blank" rel="noreferrer">rohinshanker/win98-site-kit</a>, extracted from <a href="https://rohin.shanker.me/" target="_blank" rel="noreferrer">rohin.shanker.me</a></span>
      </li>
      <li class="icon-list-row">
        <img src="assets/backgrounds/mountain-and-sky.png" alt="" />
        <span>Blue sky wallpaper via Red Star OS</span>
      </li>
      <li class="icon-list-row">
        <img src="assets/backgrounds/background-2200.jpg" alt="" />
        <span>Desktop wallpaper via Asdal Stock Photos</span>
      </li>
    </ul>`,
};
