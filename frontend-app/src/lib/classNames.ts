import { cn } from '@/lib/utils';

// Classes that only affect text. On the web they cascade from a container to
// its text; RN has no style inheritance, so components that wrap a <Text>
// (Button, Label) route these to it.
const TEXT_CLASS =
  /^(?:[a-z-]+:)*(text-|font-|tracking-|leading-|uppercase$|lowercase$|capitalize$|italic$|underline$|line-through$|no-underline$|truncate$|whitespace-|text$)/;

/** Splits a web className into text-only classes and container classes. */
export function splitTextClasses(className?: string): {
  text: string;
  rest: string;
} {
  if (!className) return { text: '', rest: '' };
  const text: string[] = [];
  const rest: string[] = [];
  for (const c of className.split(/\s+/).filter(Boolean)) {
    // `text-left/center/right` are alignment, but they still belong on the Text.
    (TEXT_CLASS.test(c) ? text : rest).push(c);
  }
  return { text: cn(text), rest: cn(rest) };
}
