export const parseProperties = (content: string): Record<string, string> => {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  let currentKey: string | null = null;

  for (const line of lines) {
    const raw = line;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (/^\s/.test(raw) && currentKey) {
      result[currentKey] += trimmed;
      continue;
    }

    const idx = trimmed.indexOf("=");
    if (idx < 0) {
      continue;
    }

    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/\\([:=#\\])/g, "$1");
    result[key] = value;
    currentKey = key;
  }

  return result;
};

export const parseManifest = (content: string): Record<string, string> => {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  let currentKey: string | null = null;

  for (const line of lines) {
    if (/^\s/.test(line) && currentKey) {
      result[currentKey] += line.trim();
      continue;
    }

    const idx = line.indexOf(":");
    if (idx < 0) {
      continue;
    }

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) {
      result[key] = value;
      currentKey = key;
    }
  }

  return result;
};

export const stripXmlNamespace = (xml: string) =>
  xml.replace(/<[\/]?\w+:([^>\s/]+)/g, (match, group: string) =>
    match.replace(/\w+:/, ""),
  );

export const extractAttributes = (tag: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const attrRegex = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(tag)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
};

export const extractTags = (xml: string, tagName: string): string[] => {
  const regex = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const matches = xml.match(regex);
  return matches ?? [];
};

export const parseParameterDefinitions = (
  xml: string,
): Array<{ name: string; type: string; required: boolean }> => {
  const blocks = xml.match(/<parameter>[\s\S]*?<\/parameter>/gi) ?? [];
  return blocks
    .map((block) => {
      const name = (block.match(/<name>([\s\S]*?)<\/name>/i)?.[1] ?? "").trim();
      const type = (block.match(/<type>([\s\S]*?)<\/type>/i)?.[1] ?? "").trim();
      const required = /<isRequired>\s*true\s*<\/isRequired>/i.test(block);
      return name ? { name, type: type || "xsd:string", required } : null;
    })
    .filter((entry): entry is { name: string; type: string; required: boolean } => Boolean(entry));
};
