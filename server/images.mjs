import sharp from 'sharp';

// Bound decoded image memory before native processing; output is always a fresh PNG.
const inputOptions={limitInputPixels:16777216,failOn:'warning'};
export async function prepareAppIcon(input,output) {
  try {
    const metadata=await sharp(input,inputOptions).metadata();
    if(!['png','jpeg'].includes(metadata.format) || (metadata.pages || 1)>1)throw new Error('unsupported');
    await sharp(input,inputOptions).rotate().resize(1024,1024,{fit:'cover',position:'centre'}).png().toFile(output);
  } catch {
    throw new Error('Không xử lý được icon. Chọn ảnh JPG/JPEG hoặc PNG hợp lệ, tối đa 16 megapixel.');
  }
}
