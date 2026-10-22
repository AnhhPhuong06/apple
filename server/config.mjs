export function publicOrigin(override,env=process.env) {
  const value=(override ?? (env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || '')).replace(/\/$/,'');
  if(!value)return '';
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/')throw new Error('PUBLIC_BASE_URL phải là tên miền HTTPS, không có đường dẫn.');
  return url.origin;
}
