// A string, a // comment or a /* */ comment: the first one found wins, so comment markers inside strings survive.
const STRING_OR_COMMENT = /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g
// A comma right before a closing bracket, or a string (kept as is)
const STRING_OR_TRAILING_COMMA = /"(?:[^"\\]|\\.)*"|,(\s*[}\]])/g

// Comments become spaces and newlines stay, so a JSON.parse error still points at the right place in the file.
// A byte order mark, which some Windows editors put first, goes too: JSON.parse rejects it.
export function stripJsonComments(text: string) {
  return text
    .replace(/^﻿/, '')
    .replace(STRING_OR_COMMENT, match => (match.startsWith('"') ? match : match.replace(/[^\n]/g, ' ')))
    .replace(STRING_OR_TRAILING_COMMA, (match, tail?: string) => tail ?? match)
}

// A file with nothing but whitespace and comments is an empty object, not an "Unexpected end of JSON input".
export function parseJsonc(text: string): unknown {
  const json = stripJsonComments(text)
  return json.trim() ? JSON.parse(json) : {}
}
