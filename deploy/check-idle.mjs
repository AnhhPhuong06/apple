const password=process.env.ADMIN_TOKEN;
if(!password)throw new Error('Missing admin credential in service environment.');
const response=await fetch('http://127.0.0.1:4173/api/health',{headers:{Authorization:'Bearer '+password},signal:AbortSignal.timeout(5000)});
if(!response.ok)throw new Error('Cannot check signing status.');
if((await response.json()).busy)throw new Error('An upload/signing operation is active.');
console.log('No active signing job.');
