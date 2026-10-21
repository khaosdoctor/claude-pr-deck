// A string, a // comment or a /* */ comment: the first one found wins, so comment markers inside strings survive.
const STRING_OR_COMMENT = /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g
// A comma right before a closing bracket, or a string (kept as is)
const STRING_OR_TRAILING_COMMA = /"(?:[^"\\]|\\.)*"|,(\s*[}\]])/g

// Comments become spaces and newlines stay, so a JSON.parse error still points at the right place in the file.
export function stripJsonComments(text: string) {
  return text
    .replace(STRING_OR_COMMENT, match => (match.startsWith('"') ? match : match.replace(/[^\n]/g, ' ')))
    .replace(STRING_OR_TRAILING_COMMA, (match, tail?: string) => tail ?? match)
}

export const parseJsonc = (text: string): unknown => JSON.parse(stripJsonComments(text))
