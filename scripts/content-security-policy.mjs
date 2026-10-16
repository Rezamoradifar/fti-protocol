// Wallet images are fetched by AppKit and displayed through URL.createObjectURL.
// Permit blob URLs only for images, and only when WalletConnect is enabled.
export function contentSecurityPolicy(walletConnectProjectId) {
 return `default-src 'self'; script-src 'self'; style-src 'self' ${walletConnectProjectId?"'unsafe-inline'":''}; connect-src 'self' ${walletConnectProjectId?"https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org https://*.reown.com https://api.web3modal.org":''}; img-src 'self' data: ${walletConnectProjectId?"blob: https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com https://api.web3modal.org":''}; font-src 'self' ${walletConnectProjectId?'https://fonts.reown.com':''}; frame-src 'self' ${walletConnectProjectId?'https://verify.walletconnect.com https://verify.walletconnect.org':''}; frame-ancestors 'none'; base-uri 'none'`;
}
