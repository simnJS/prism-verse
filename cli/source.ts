export interface Span {
  start: number;
  end: number;
}

export class SourceFile {
  readonly name: string;
  readonly text: string;
  readonly lineStarts: number[];

  constructor(name: string, text: string) {
    this.name = name;
    this.text = text;
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") this.lineStarts.push(i + 1);
    }
  }

  position(offset: number): { line: number; column: number } {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.lineStarts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - (this.lineStarts[low] ?? 0) + 1 };
  }

  lineText(line: number): string {
    const start = this.lineStarts[line - 1] ?? 0;
    const next = this.lineStarts[line];
    const end = next === undefined ? this.text.length : next - 1;
    return this.text.slice(start, end).replace(/\r$/, "");
  }
}
