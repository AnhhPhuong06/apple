import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {prepareAppIcon} from '../server/images.mjs';

test('JPG/JPEG and PNG icons become square PNGs with orientation applied and metadata removed',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'appspace-icons-'));
 try {
  for(const ext of ['jpg','jpeg','png']) {
   const input=path.join(dir,'source.'+ext),output=path.join(dir,'icon-'+ext+'.png');
   const image=sharp({create:{width:160,height:90,channels:3,background:'#eb8935'}});
   await (ext==='png'?image.png():image.jpeg().withMetadata({orientation:6})).toFile(input);
   await prepareAppIcon(input,output);
   const info=await sharp(output).metadata();assert.equal(info.format,'png');assert.equal(info.width,1024);assert.equal(info.height,1024);assert.equal(info.orientation,undefined);assert.equal(info.exif,undefined);
   const original=await sharp(input).metadata();assert.equal(original.format,ext==='png'?'png':'jpeg');
   const {data}=await sharp(output).raw().toBuffer({resolveWithObject:true});assert.ok(data[0]>200);assert.ok(data[2]<90);
  }
  const rotated=path.join(dir,'rotated.jpg'),result=path.join(dir,'rotated.png');
  const red=await sharp({create:{width:40,height:80,channels:3,background:'red'}}).png().toBuffer();
  await sharp({create:{width:80,height:80,channels:3,background:'blue'}}).composite([{input:red,left:0,top:0}]).jpeg().withMetadata({orientation:6}).toFile(rotated);
  await prepareAppIcon(rotated,result);
  const top=await sharp(result).extract({left:500,top:100,width:1,height:1}).removeAlpha().raw().toBuffer();const bottom=await sharp(result).extract({left:500,top:900,width:1,height:1}).removeAlpha().raw().toBuffer();assert.ok(top[0]>200 && top[2]<50);assert.ok(bottom[2]>200 && bottom[0]<50);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('corrupt, unsupported and oversized pixel icons are rejected',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'appspace-bad-icons-'));try {
  for(const [name,bytes] of [['invalid.jpg',Buffer.from([255,216,255,1,2])],['fake.png',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>')]]) {const input=path.join(dir,name);await writeFile(input,bytes);await assert.rejects(prepareAppIcon(input,path.join(dir,name+'.png')),/JPG\/JPEG/);}
  const big=path.join(dir,'big.png');await sharp({create:{width:4100,height:4100,channels:3,background:'white'}}).png().toFile(big);await assert.rejects(prepareAppIcon(big,path.join(dir,'output.png')),/16 megapixel/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
