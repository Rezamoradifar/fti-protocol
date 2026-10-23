// Tiny presentation-only overlay for installed releases awaiting a full rebuild.
export const OFFICIAL_TELEGRAM = 'https://t.me/FTIProtocol_Official';
const hosts = new Set(['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me']);
const handles = new Set(['/ftiprotocol', '/fti_protocol', '/ftiprotocol_official']);

export function updateTelegramLinks(root) {
  const anchors = [];
  if (root?.matches?.('a[href]')) anchors.push(root);
  if (root?.querySelectorAll) anchors.push(...root.querySelectorAll('a[href]'));
  for (const anchor of anchors) {
    let url;
    try { url = new URL(anchor.getAttribute('href'), 'https://ftiprotocol.com/'); }
    catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || !hosts.has(url.hostname.toLowerCase()) ||
        !handles.has(url.pathname.replace(/\/$/, '').toLowerCase())) continue;
    if (anchor.getAttribute('href') !== OFFICIAL_TELEGRAM) anchor.setAttribute('href', OFFICIAL_TELEGRAM);
    for (const label of anchor.querySelectorAll('small')) {
      const text = label.textContent.trim();
      if (/^@(?:FTIProtocol|fti_protocol)$/i.test(text)) label.textContent = '@FTIProtocol_Official';
    }
    for (const node of anchor.childNodes) {
      if (node.nodeType !== 3) continue;
      const text = node.textContent.trim();
      if (/^@(?:FTIProtocol|fti_protocol)$/i.test(text)) node.textContent = '@FTIProtocol_Official';
      else if (/^https?:\/\/(?:t\.me|telegram\.me)\/(?:FTIProtocol|fti_protocol)\/?$/i.test(text)) node.textContent = OFFICIAL_TELEGRAM;
    }
    for (const name of ['title', 'aria-label']) {
      const value = anchor.getAttribute(name);
      if (value && /@(?:FTIProtocol|fti_protocol)(?!_Official)\b/i.test(value)) {
        anchor.setAttribute(name, value.replace(/@(?:FTIProtocol|fti_protocol)(?!_Official)\b/gi, '@FTIProtocol_Official'));
      }
    }
  }
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  updateTelegramLinks(document);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') updateTelegramLinks(record.target);
      else {
        updateTelegramLinks(record.target.closest?.('a[href]'));
        for (const node of record.addedNodes) updateTelegramLinks(node);
      }
    }
  }).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['href']});
}
