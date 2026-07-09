"use client";

import type { ReactNode } from "react";

// Tiny markdown renderer for AI answers (Guru chat, coach notes): paragraphs,
// bullet/numbered lists, **bold**, *italic*, `code`. No dependency, no HTML
// injection — everything becomes React nodes.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Tokenize bold, italic, code spans in one pass.
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] != null) out.push(<strong key={`${keyBase}-${i++}`}>{m[2]}</strong>);
    else if (m[4] != null) out.push(<em key={`${keyBase}-${i++}`}>{m[4]}</em>);
    else if (m[6] != null) out.push(<code key={`${keyBase}-${i++}`}>{m[6]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={`p${key++}`}>{inline(para.join(" "), `p${key}`)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, j) => <li key={j}>{inline(it, `l${key}-${j}`)}</li>);
      blocks.push(list.ordered ? <ol key={`o${key++}`}>{items}</ol> : <ul key={`u${key++}`}>{items}</ul>);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (bullet) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
    } else if (numbered) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(<p key={`h${key++}`}><strong>{inline(heading[1], `h${key}`)}</strong></p>);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return <div className="md">{blocks}</div>;
}
