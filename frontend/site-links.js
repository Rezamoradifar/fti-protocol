export const PRIMARY_DOMAIN='ftiprotocol.com';
export function siteLinks(url){
 // Stay on the current origin: browser wallet permissions and session storage
 // cannot be shared safely by switching between sibling subdomains.
 const {origin}=new URL(url);
 return {main:origin+'/',member:origin+'/app/',token:origin+'/token-site/',trade:origin+'/token/#trade',council:origin+'/admin/',whitepaper:origin+'/whitepaper/',roadmap:origin+'/roadmap/'};
}
