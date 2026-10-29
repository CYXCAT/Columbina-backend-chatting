// Cuts streamed LLM text into sentences so speech synthesis can start before the reply is complete.
// A sentence ends at CJK end punctuation, at a newline, or at . ! ? followed by whitespace (so "3.5"
// and "e.g." mid-word don't split). Very short fragments are merged into the next sentence.
const END = /[。！？!?；;…\n]|[.!?](?=\s)/g;
const MIN_LENGTH = 6;

export class SentenceSplitter {
  private buffer = "";

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    let start = 0;
    for (const m of this.buffer.matchAll(END)) {
      const end = m.index + m[0].length;
      const sentence = this.buffer.slice(start, end).trim();
      if (sentence.length < MIN_LENGTH) continue;
      out.push(sentence);
      start = end;
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }
}
