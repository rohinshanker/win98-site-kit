// The Study Resources tree. Edit this file to publish your own material.
// A folder is `{ name, type: "folder", children: [...] }`. A file is
// `{ name, type: "pdf" | "link", href, size?, pages? }`: PDFs preview in the
// window and can be downloaded, links open in a new tab. `size` is bytes
// and feeds the status bar; `pages` caps the PDF preview thumbnails.

export const ROOT_NAME = "Study Resources";

export default [
  {
    name: "Course Notes",
    type: "folder",
    children: [
      {
        name: "Sample Notes.pdf",
        type: "pdf",
        href: "assets/study-resources/sample-notes.pdf",
        size: 632,
        pages: 1,
      },
    ],
  },
  {
    name: "Cheat Sheets",
    type: "folder",
    children: [
      {
        name: "Sample Cheat Sheet.pdf",
        type: "pdf",
        href: "assets/study-resources/sample-cheatsheet.pdf",
        size: 632,
        pages: 1,
      },
      {
        name: "Khan Academy",
        type: "link",
        href: "https://www.khanacademy.org/",
      },
    ],
  },
];
