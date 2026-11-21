// The form displays stages only when the corresponding operation actually begins.
export function purchaseGuide(document, translate) {
 let panel = null;
 let pendingPanel = null;

 function show(message) {
  if (panel) {
   panel.textContent = translate(message);
   panel.hidden = false;
  }
 }

 function clear() {
  for (const element of document.querySelectorAll('[data-purchase-guide]')) {
   element.textContent = '';
   element.hidden = true;
  }
  panel = null;
  pendingPanel = null;
 }

 return {
  start(id) {
   panel = id ? document.getElementById(id + '-guide') : null;
   show('Checking the wallet and balance. Next we check the spending allowance.');
  },
  show,
  waiting() {
   if (panel) pendingPanel = panel;
   show('Checking the previous request. Wait for its result before starting another purchase.');
  },
  resolved(message) {
   if (pendingPanel) pendingPanel.textContent = translate(message);
   pendingPanel = null;
  },
  finish() { panel = null; },
  clear
 };
}
