// Genesis order belongs to the active deployment, including on local rehearsal networks.
export function registrationRoot(config) {
 const root = config?.genesis?.[0];
 if (typeof root !== 'string' || !/^0x[0-9a-f]{40}$/i.test(root) || /^0x0{40}$/i.test(root)) return null;
 if (Number(config.chainId) === 56 && root.toLowerCase() !== '0xd6492377c2c33047afe61768930b2aedff2b2704') return null;
 return root;
}

export function selectRootSponsor(field, root, win) {
 if (!root || field.disabled) return;
 field.value = root;
 field.setCustomValidity('');
 field.dispatchEvent(new Event('input', {bubbles:true}));
 // Keep the invitation on a wallet round-trip even in installations without the referral overlay.
 const url = new URL(win.location.href);
 for (const alias of ['ref', 'referrer']) url.searchParams.delete(alias);
 url.searchParams.set('sponsor', root);
 url.hash = 'network';
 win.history.replaceState(win.history.state, '', url);
}
