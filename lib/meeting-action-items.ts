// The Inbox's "File as meeting summary" action (components/inbox/
// inbox-tabs.tsx) scans the item's own text for likely action items —
// lines starting with a bullet character, or with one of a handful of
// English/Spanish keywords — and offers them pre-filled in the New
// Meeting form's own Action items editor, where they can be edited or
// removed before saving (nothing here writes anything; it's pure text
// scanning).
const BULLET_PREFIXES = ["-", "•", "*"];
const KEYWORD_PREFIXES = ["todo", "next", "action", "acción", "accion", "pendiente"];

export function suggestActionItemsFromText(text: string): string[] {
  const items: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const bullet = BULLET_PREFIXES.find((b) => line.startsWith(b));
    if (bullet) {
      const rest = line.slice(bullet.length).trim();
      if (rest) items.push(rest);
      continue;
    }

    const lowerLine = line.toLowerCase();
    const keyword = KEYWORD_PREFIXES.find((kw) => lowerLine.startsWith(kw));
    if (keyword) {
      const rest = line
        .slice(keyword.length)
        .replace(/^[:\-–—\s]+/, "")
        .trim();
      if (rest) items.push(rest);
    }
  }

  return items;
}
