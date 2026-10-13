// A local ABI or config flag alone must never advertise a deployed economic change.
export async function readHourlyCapFlushVersion(binary){
 if(!binary.interface.hasFunction('hourlyCapFlushVersion'))return null;
 try{return (await binary.hourlyCapFlushVersion())===1n?1:null;}
 catch{return null;}
}
