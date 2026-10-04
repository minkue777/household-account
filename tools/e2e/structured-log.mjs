/** Firebase CLI appends a second metadata JSON object after the runtime payload. */
export function firstLogObject(line) {
  const start = line.indexOf('{');
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; start >= 0 && index < line.length; index++) {
    const character = line[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return JSON.parse(line.slice(start, index + 1));
  }
  throw new Error('Runtime structured log is missing or truncated');
}
