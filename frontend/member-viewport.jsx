import {useEffect} from 'react';

// Native mobile focus scrolling does not account for a fixed navigation dock.
// Keep the active form field in the usable viewport, including keyboard resizes.
export function MemberViewport({active}) {
  useEffect(() => {
    if (!active) return;
    let frame;
    const keepVisible = () => {
      const field = document.activeElement;
      if (!field?.matches('input, select, textarea') || !field.closest('main')) return;
      const dock = document.querySelector('.sidebar nav');
      if (!dock || getComputedStyle(dock).position !== 'fixed') return;
      const viewport = window.visualViewport;
      const top = (viewport?.offsetTop || 0) + 12;
      const bottom = Math.min(dock.getBoundingClientRect().top,
        (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight)) - 12;
      const bounds = field.getBoundingClientRect();
      if (bottom - top < bounds.height) return;
      const delta = bounds.bottom > bottom ? bounds.bottom - bottom
        : bounds.top < top ? bounds.top - top : 0;
      if (delta) window.scrollBy({top: delta, behavior: 'auto'});
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        keepVisible();
        frame = requestAnimationFrame(keepVisible);
      });
    };
    document.addEventListener('focusin', schedule);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, [active]);
  return null;
}
