export const PRIMARY_DOMAIN='ftiprotocol.com';
export function siteLinks(url){
 const {hostname,origin}=new URL(url);
 const split=[PRIMARY_DOMAIN,'www.'+PRIMARY_DOMAIN,'app.'+PRIMARY_DOMAIN,'token.'+PRIMARY_DOMAIN,'council.'+PRIMARY_DOMAIN].includes(hostname);
 return split?{main:'https://'+PRIMARY_DOMAIN+'/',member:'https://app.'+PRIMARY_DOMAIN+'/app/',token:'https://token.'+PRIMARY_DOMAIN+'/token-site/',trade:'https://token.'+PRIMARY_DOMAIN+'/token/#trade',council:'https://council.'+PRIMARY_DOMAIN+'/admin/',whitepaper:'https://token.'+PRIMARY_DOMAIN+'/whitepaper/',roadmap:'https://token.'+PRIMARY_DOMAIN+'/roadmap/'}:{main:origin+'/',member:origin+'/app/',token:origin+'/token-site/',trade:origin+'/token/#trade',council:origin+'/admin/',whitepaper:origin+'/whitepaper/',roadmap:origin+'/roadmap/'};
}
