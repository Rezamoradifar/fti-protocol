// Advertise pooled economics only after the connected proxy confirms activation.
export async function readPoolDistributionVersion(binary,overrides={}){
 if(!binary.interface.hasFunction('poolDistributionVersion'))return null;
 try{return (await binary.poolDistributionVersion(overrides))===1n?1:null;}
 catch{return null;}
}
