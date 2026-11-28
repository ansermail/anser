// Match SQLite's NOCASE collation, which folds ASCII characters only.
const foldTagName = (name: string) =>
  name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

export function findMailTag(tags: readonly string[], name: string) {
  const key = foldTagName(name.trim());
  return tags.find((tag) => foldTagName(tag) === key);
}
