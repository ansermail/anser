// Mirror Tauri file associations in the stable development bundle.
function xml(value) {
  return String(value).replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );
}
export function documentTypes(associations = []) {
  if (!associations.length) return "";
  const strings = (values) =>
    values.map((value) => `<string>${xml(value)}</string>`).join("");
  return `<key>CFBundleDocumentTypes</key><array>${associations
    .map(
      (item) =>
        `<dict><key>CFBundleTypeName</key><string>${xml(item.name ?? item.ext.join(" "))}</string>` +
        `<key>CFBundleTypeRole</key><string>${xml(item.role ?? "Editor")}</string>` +
        `<key>LSHandlerRank</key><string>${xml(item.rank ?? "Default")}</string>` +
        `<key>CFBundleTypeExtensions</key><array>${strings(item.ext)}</array>` +
        (item.contentTypes?.length
          ? `<key>LSItemContentTypes</key><array>${strings(item.contentTypes)}</array>`
          : "") +
        `</dict>`,
    )
    .join("")}</array>`;
}
