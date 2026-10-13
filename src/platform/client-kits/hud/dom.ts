/** An element from `'tag.class.class'` (a div if no tag), holding `children` (text or elements). */
export function el(spec: string, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const [tag, ...classes] = spec.split('.');
  const e = document.createElement(tag || 'div');
  for (const c of classes) e.classList.add(c);
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}
