// Dedicated views share the same deployment and wallet session.
export const surface=location.pathname.startsWith('/admin')?'admin':location.pathname.startsWith('/token')?'token':'member';
export const surfaceTitle={member:'MEMBER WORKSPACE',token:'FTI TOKEN',admin:'PROTOCOL ADMINISTRATION'}[surface];
export const surfacePages={member:[['overview','Overview'],['network','Membership'],['rewards','Rewards'],['activity','Activity']],token:[['token-home','Token overview'],['trade','Buy & sell'],['activity','Activity']],admin:[['admin','Management'],['activity','Activity']]}[surface];
export const defaultPage=surfacePages[0][0];
export function pagePath(page){if(['trade','token-home'].includes(page))return '/token/#'+page;if(page==='admin')return '/admin/';return '/app/#'+page;}
