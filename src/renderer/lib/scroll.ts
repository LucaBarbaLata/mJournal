/**
 * Scrolls the main content area (and only that) so `element` is near the top.
 * Element.scrollIntoView would also scroll the clipped page itself, shifting
 * the whole window.
 */
export function scrollMainTo(element: Element | null, behavior: ScrollBehavior = 'auto'): void {
  const container = document.querySelector('.main-scroll');
  if (!element || !container) return;
  const offset = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTo({ top: container.scrollTop + offset - 16, behavior });
}
