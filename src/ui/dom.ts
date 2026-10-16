type Child = Node | string | null | undefined | false;

/** Small element factory. Text is always set via text nodes, never as HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false) continue;
    if (key === 'class') node.className = String(value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const b = el('button', { type: 'button', class: className }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function formatDeg(value: number): string {
  return `${value.toLocaleString('de-CH', { maximumFractionDigits: 1 })}°`;
}
