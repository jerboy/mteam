// BBCode has site-specific dialects. Keep a small, explicit set of safe tags;
// never turn forum markup into HTML strings or run Markdown inside BBCode.
const inline = new Set(['b', 'i', 'u', 's', 'strike', 'del', 'sup', 'sub', 'color', 'size', 'font', 'url', 'img']);
const block = new Set(['quote', 'code', 'pre', 'nfo', 'mediainfo', 'list', 'ul', 'ol', 'li', 'left', 'center', 'right', 'align', 'spoiler', 'hide']);
const literal = new Set(['code', 'pre', 'nfo', 'mediainfo', 'img']);
const standalone = new Set(['br', 'hr']);
const lists = new Set(['list', 'ul', 'ol']);
const supported = new Set([...inline, ...block, ...standalone]);
const tagPattern = /\[(\/?)([a-z][a-z0-9]*|\*)(?:[=\s]([^\]\r\n]{0,1024}))?\]/iy;

function tagAt(source, offset) {
  tagPattern.lastIndex = offset;
  const match = tagPattern.exec(source);
  if (!match) return null;
  const tag = match[2].toLowerCase();
  if (!supported.has(tag) && tag !== '*') return null;
  let value = (match[3] || '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return { tag, closing: Boolean(match[1]), value, end: offset + match[0].length, raw: match[0] };
}

// A Markdown document merely demonstrating BBCode should remain Markdown.
function codeEnd(source, offset) {
  const run = /^(?:`+|~{3,})/.exec(source.slice(offset))?.[0];
  if (!run) return offset + 1;
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  if (run.length >= 3 && /^ {0,3}$/.test(source.slice(lineStart, offset))) {
    const end = new RegExp(`^ {0,3}${run[0]}{${run.length},}[ \\t]*(?:\\n|$)`, 'gm');
    end.lastIndex = source.indexOf('\n', offset) + 1;
    if (end.lastIndex > offset) {
      const match = end.exec(source);
      return match ? end.lastIndex : source.length;
    }
  }
  if (run[0] === '`') {
    const end = /`+/g;
    end.lastIndex = offset + run.length;
    let match;
    while ((match = end.exec(source))) if (match[0].length === run.length) return end.lastIndex;
  }
  return offset + run.length;
}

function rawEnd(source, start, tag, limits) {
  const close = new RegExp(`\\[/${tag}\\]`, 'ig');
  close.lastIndex = start;
  const match = close.exec(source);
  limits.remaining -= (match ? close.lastIndex : source.length) - start;
  if (limits.remaining < 0) throw new RangeError('BBCode parsing budget exceeded');
  return match ? { bodyEnd: match.index, end: close.lastIndex } : null;
}

function hasBBCode(source, limits) {
  for (let offset = 0; offset < source.length;) {
    if (source[offset] === '\\') { offset += 2; continue; }
    if (source[offset] === '`' || source[offset] === '~') { offset = codeEnd(source, offset); continue; }
    const tag = source[offset] === '[' ? tagAt(source, offset) : null;
    if (tag && !tag.closing && tag.tag !== '*' &&
      (standalone.has(tag.tag) || rawEnd(source, tag.end, tag.tag, limits))) return true;
    offset = tag ? tag.end : offset + 1;
  }
  return false;
}

function textToken(tokens, text) {
  if (!text) return;
  if (tokens.at(-1)?.type === 'bbtext') tokens.at(-1).text += text;
  else tokens.push({ type: 'bbtext', text });
}

function listItems(tokens) {
  const items = [];
  let current = [];
  const flush = () => {
    if (current.some(token => token.type !== 'bbtext' || token.text.trim())) items.push(current);
    current = [];
  };
  for (const token of tokens) {
    if (token.type === 'bbitem') flush();
    else if (token.type === 'bbcode' && token.tag === 'li') { flush(); items.push(token.tokens); }
    else current.push(token);
  }
  flush();
  return items;
}

// Returns null when there is no recognizable BBCode, allowing Markdown fallback.
// A stack preserves nested tags in linear time; malformed tags remain readable.
export function lexBBCode(source) {
  const limits = { remaining: 240000 };
  if (!hasBBCode(source, limits)) return null;
  const stack = [{ tokens: [] }];
  for (let offset = 0; offset < source.length;) {
    const frame = stack.at(-1);
    const tag = source[offset] === '[' ? tagAt(source, offset) : null;
    if (!tag) {
      const next = source.indexOf('[', offset + 1);
      const end = next < 0 ? source.length : next;
      textToken(frame.tokens, source.slice(offset, end)); offset = end; continue;
    }
    if (tag.tag === '*' && lists.has(frame.tag)) frame.tokens.push({ type: 'bbitem', raw: tag.raw });
    else if (tag.closing && tag.tag === frame.tag) {
      stack.pop();
      const token = { type: 'bbcode', tag: frame.tag, value: frame.value,
        raw: source.slice(frame.start, tag.end), text: source.slice(frame.bodyStart, offset), tokens: frame.tokens };
      if (lists.has(token.tag)) token.items = listItems(token.tokens);
      stack.at(-1).tokens.push(token);
    } else if (tag.closing || tag.tag === '*') textToken(frame.tokens, tag.raw);
    else if (standalone.has(tag.tag)) frame.tokens.push({ type: 'bbcode', tag: tag.tag, value: '', raw: tag.raw });
    else if (literal.has(tag.tag)) {
      const end = rawEnd(source, tag.end, tag.tag, limits);
      if (end) {
        frame.tokens.push({ type: 'bbcode', tag: tag.tag, value: tag.value,
          raw: source.slice(offset, end.end), text: source.slice(tag.end, end.bodyEnd) });
        offset = end.end; continue;
      }
      textToken(frame.tokens, tag.raw);
    } else {
      if (stack.length >= 40) throw new RangeError('BBCode nesting limit exceeded');
      stack.push({ tag: tag.tag, value: tag.value, start: offset, bodyStart: tag.end, opening: tag.raw, tokens: [] });
    }
    offset = tag.end;
  }
  while (stack.length > 1) {
    const frame = stack.pop();
    textToken(stack.at(-1).tokens, frame.opening);
    stack.at(-1).tokens.push(...frame.tokens);
  }
  return stack[0].tokens;
}

export function bbcodeColor(value) {
  return /^(?:#[\da-f]{3}(?:[\da-f]{3})?|black|white|red|green|blue|yellow|orange|purple|gray|grey|silver|maroon|olive|lime|aqua|teal|navy|fuchsia)$/i.test(value) ? value : '';
}

export function bbcodeSize(value) {
  const match = /^(\d{1,3})(px|%)?$/.exec(value);
  if (!match) return '';
  const number = Number(match[1]);
  const pixels = !match[2] && number >= 1 && number <= 7 ? [11, 12, 13, 14, 16, 18, 20][number - 1] :
    match[2] === '%' || (!match[2] && number >= 50) ? 13 * number / 100 : number;
  return `${Math.max(11, Math.min(20, pixels))}px`;
}
