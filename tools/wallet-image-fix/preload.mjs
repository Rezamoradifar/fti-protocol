// Temporary compatibility overlay for the verified, immutable mainnet release.
import {ServerResponse} from 'node:http';
export function repairPolicy(value) {
 if (typeof value !== 'string') return value;
 return value.split(';').map(part => {
  const words = part.trim().split(/\s+/);
  if (words[0] !== 'img-src' || !words.includes('https://api.web3modal.org') || words.includes('blob:')) return part;
  return part.replace(/(img-src\s+)/, '$1blob: ');
 }).join(';');
}
const original = ServerResponse.prototype.setHeader;
ServerResponse.prototype.setHeader = function(name, value) {
 return original.call(this, name, String(name).toLowerCase() === 'content-security-policy' ? repairPolicy(value) : value);
};
