const fileTypes=Object.freeze({
 'application/pdf':'pdf',
 'image/jpeg':'jpg',
 'image/png':'png',
 'image/webp':'webp'
});
function validReceipt(bytes,extension){
 if(extension==='pdf')return bytes.subarray(0,5).toString('ascii')==='%PDF-';
 if(extension==='jpg')return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(extension==='png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 return extension==='webp'&&bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'
  &&bytes.subarray(8,12).toString('ascii')==='WEBP'&&bytes.readUInt32LE(4)+8<=bytes.length;
}
module.exports={fileTypes,validReceipt};
