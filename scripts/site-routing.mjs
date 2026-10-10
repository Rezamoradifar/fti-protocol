export function rootForHost(host){
 const hostname=String(host||'').split(':')[0].toLowerCase();
 return {'app.ftiprotocol.com':'/app/','token.ftiprotocol.com':'/token-site/','council.ftiprotocol.com':'/admin/'}[hostname]||null;
}
export const PUBLIC_ROUTES=['/token-site/','/whitepaper/','/roadmap/'];
