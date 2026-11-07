import React from 'react';
import {useDeploymentConfig} from './use-deployment-config.js';
import {TokenPrice} from './token-price.jsx';
import {HourlyPool} from './hourly-pool.jsx';
export default function LiveData({lang}){
 const {config,loading,error,retry}=useDeploymentConfig();
 const shared={config,lang,configLoading:loading,configError:error,onRetryConfig:retry};
 return <><div className="container live-price-wrap"><p className="status">{config?.chainId===56?'BNB Mainnet · 56':config?.chainId===97?'BNB Testnet · 97':'—'}</p><TokenPrice {...shared} className="" showMetrics/></div><HourlyPool {...shared}/></>;
}
