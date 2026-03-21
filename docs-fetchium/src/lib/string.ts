export function dedent(str: string) {
  // Find the minimum indentation level (excluding empty lines)
  const lines = str.split('\n');
  const minIndent = lines
    .filter((line) => line.trim().length > 0)
    .reduce((min, line) => {
      const indent = line.match(/^\s*/)?.[0]?.length ?? 0;
      return Math.min(min, indent);
    }, Infinity);

  // Remove the minimum indentation from each line
  return lines
    .map((line) => line.slice(minIndent))
    .join('\n')
    .trim();
}
