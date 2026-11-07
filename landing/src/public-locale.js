// English is the default; other language catalogs load only when selected.
// The shared policy retains the URL, referral and saved language preference.
import {language} from '../../frontend/language-policy.js';
export {language,initializeLanguage,LANGUAGES,changeLanguage,withLanguage} from '../../frontend/language-policy.js';
let catalog;
if(language!=='en') catalog=await import('../../frontend/locale.js');
export function translate(value,lang=language,fa){
 return catalog ? catalog.translate(value,lang,fa) : String(value);
}
