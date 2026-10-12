export const SOCIAL_PLATFORMS=Object.freeze([
 {id:'telegram',name:'Telegram',hosts:['t.me','telegram.me']},
 {id:'x',name:'X',hosts:['x.com','www.x.com','twitter.com','www.twitter.com']},
 {id:'instagram',name:'Instagram',hosts:['instagram.com','www.instagram.com']},
 {id:'youtube',name:'YouTube',hosts:['youtube.com','www.youtube.com']},
 {id:'linkedin',name:'LinkedIn',hosts:['linkedin.com','www.linkedin.com']},
 {id:'discord',name:'Discord',hosts:['discord.gg','discord.com','www.discord.com']},
]);
export function validatedSocialLinks(config){
 if(!config||typeof config!=='object'||Array.isArray(config))return [];
 return SOCIAL_PLATFORMS.flatMap(platform=>{
  const raw=config[platform.id];if(typeof raw!=='string'||raw.length>2048||/[\u0000-\u0020\u007f]/.test(raw))return [];
  try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port||!platform.hosts.includes(u.hostname)||u.pathname==='/')return [];
   if(['share','intent','login','oauth','proxy','redirect','attribution_link','out','l.php'].includes(u.pathname.split('/')[1]))return [];
   return [{id:platform.id,name:platform.name,href:u.href}];
  }catch{return [];}
 });
}
