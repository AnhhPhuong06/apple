(function () {
  'use strict';
  const validApp=(app,id)=>app && app.id===id && typeof app.name==='string' && app.name.trim().length>0;
  async function resolve(params,catalog,load) {
    const entries=Array.isArray(catalog)?catalog:[];
    const job=params.get('job'),appId=params.get('app');
    if(job!==null && appId!==null && job!==appId)throw new Error('Conflicting app IDs');
    const id=job ?? appId;
    if(id===null && params.has('demo')) {
      const sample=entries.find(entry=>entry?.sample && validApp(entry,entry.id));
      if(!sample)throw new Error('Demo unavailable');
      return sample;
    }
    if(typeof id!=='string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw new Error('Invalid app ID');
    const entry=entries.find(item=>item?.id===id);
    const selected=entry ?? await load(id);
    if(!validApp(selected,id))throw new Error('App unavailable');
    return selected;
  }
  window.AppDetails={resolve};
})();
