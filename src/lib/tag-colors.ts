export function tagColorClass(tag: string) {
  let hash = 0;
  for (const character of tag.toLowerCase()) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return `tag-color-${hash % 8}`;
}
