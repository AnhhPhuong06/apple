import {createApp} from './app.mjs';
const {app,host,port}=await createApp();
const server=app.listen(port,host,()=>console.log(`AppSpace Sign: http://${host}:${port}/`));
server.requestTimeout=15*60*1000;
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Cổng ${port} đang được dùng. Chọn PORT khác hoặc dừng máy chủ cũ.`:error.message);process.exitCode=1;});
