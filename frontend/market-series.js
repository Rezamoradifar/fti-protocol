export function chartGeometry(points){
 if(!points.length)return null;
 const values=points.map(p=>p.price);if(values.some(v=>!Number.isFinite(v)||v<0))throw Error('Invalid chart price');
 const low=Math.min(...values),high=Math.max(...values),pad=Math.max((high-low)*.15,high*.001,1e-9);
 const first=points[0].time,last=points.at(-1).time;
 const xy=points.map(p=>[54+(p.time-first)/Math.max(1,last-first)*680,24+(high+pad-p.price)/(high-low+2*pad)*210]);
 return {xy,line:xy.map(([x,y],i)=>{if(!i)return 'M'+x.toFixed(2)+' '+y.toFixed(2);const [px,py]=xy[i-1],mid=((px+x)/2).toFixed(2);return 'C'+mid+' '+py.toFixed(2)+' '+mid+' '+y.toFixed(2)+' '+x.toFixed(2)+' '+y.toFixed(2);}).join(' '),low,high,change:points[0].price?(points.at(-1).price/points[0].price-1)*100:null};
}
