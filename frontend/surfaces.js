// Separate entry points, one shared wallet/API integration.
export const workspacePages={member:[['overview','Overview'],['network','Membership'],['rewards','Rewards'],['activity','Activity']],token:[['token-home','Token overview'],['trade','Buy & sell'],['activity','Activity']],admin:[['admin','Management'],['activity','Activity']]};
export function surfaceForPath(pathname){return /^\/admin(?:\/|$)/.test(pathname)?'admin':/^\/token(?:\/|$)/.test(pathname)?'token':'member';}
export const surface=surfaceForPath(globalThis.location?.pathname||'/app/');
export const surfaceTitle={member:'MEMBER WORKSPACE',token:'FTI TOKEN',admin:'PROTOCOL ADMINISTRATION'}[surface];
export const surfacePages=workspacePages[surface];
export const defaultPage=surfacePages[0][0];
export const pageTitles={'token-home':'FTI token',overview:'Overview',network:'Membership & network',trade:'Buy & sell FTI',rewards:'Your rewards',activity:'Protocol activity',admin:'Governance & settlement'};
export function pagePath(page,currentSurface='member'){if(page==='activity')return {member:'/app/',token:'/token/',admin:'/admin/'}[currentSurface]+'#activity';if(['trade','token-home'].includes(page))return '/token/#'+page;if(page==='admin')return '/admin/#admin';return '/app/#'+page;}
export function resolvePage(page,currentSurface=surface){return pageTitles[page]?page:workspacePages[currentSurface][0][0];}
export function createWorkspaceRouter({window,document,onNavigate=()=>{},currentSurface=surface}){
 const navigate=(requested,{focus=false,historyMode='push'}={})=>{
  const page=resolvePage(requested,currentSurface);
  if(!workspacePages[currentSurface].some(([id])=>id===page)){window.location.assign(pagePath(page,currentSurface));return page;}
  document.querySelectorAll('.page').forEach(p=>{p.hidden=p.id!==page;});
  document.querySelectorAll('[data-page]').forEach(button=>{const active=button.dataset.page===page;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  const title=document.getElementById('page-title');title.textContent=pageTitles[page];document.title=pageTitles[page]+' · FTI Protocol';
  if(window.location.hash!=='#'+page&&historyMode!=='none')window.history[historyMode==='replace'?'replaceState':'pushState']({ftiPage:page},'','#'+page);
  if(focus){title.focus({preventScroll:true});document.getElementById('main').scrollIntoView({behavior:'instant'});}
  onNavigate(page);return page;
 };
 document.querySelectorAll('[data-page],[data-go]').forEach(button=>{button.onclick=()=>navigate(button.dataset.page||button.dataset.go,{focus:true});});
 const historyChanged=()=>navigate(window.location.hash.slice(1),{historyMode:'none'});
 window.addEventListener('popstate',historyChanged);window.addEventListener('hashchange',historyChanged);
 return navigate;
}
