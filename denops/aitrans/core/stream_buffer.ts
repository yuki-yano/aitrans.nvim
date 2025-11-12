export type StreamingBuffer = {
  append(text: string): string[];
  getLines(): string[];
  clear(): void;
  drainText(): string;
};

export function createStreamingBuffer(): StreamingBuffer {
  let lines = [""];

  const append = (text: string): string[] => {
    if (text.length === 0) {
      return [...lines];
    }
    const segments = text.split("\n");
    lines[lines.length - 1] += segments[0];
    for (let i = 1; i < segments.length; i++) {
      lines.push(segments[i]);
    }
    return [...lines];
  };

  const getLines = (): string[] => [...lines];

  const clear = (): void => {
    lines = [""];
  };

  const drainText = (): string => {
    const text = lines.join("\n");
    clear();
    return text;
  };

  return { append, getLines, clear, drainText };
}
