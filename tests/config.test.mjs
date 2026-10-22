import test from 'node:test';
import assert from 'node:assert/strict';
import {publicOrigin} from '../server/config.mjs';

test('Render provides HTTPS automatically; custom domain and explicit settings take precedence',()=>{
 const env={RENDER_EXTERNAL_URL:'https://appspace-test.onrender.com/'};
 assert.equal(publicOrigin(undefined,env),'https://appspace-test.onrender.com');
 assert.equal(publicOrigin(undefined,{...env,PUBLIC_BASE_URL:'https://apps.example.com/'}),'https://apps.example.com');
 assert.equal(publicOrigin('https://override.example.com',env),'https://override.example.com');
 assert.equal(publicOrigin('',env),'');assert.equal(publicOrigin(undefined,{}),'');
 for(const value of ['http://example.com','https://user:secret@example.com','https://example.com/subpath','https://example.com/?x=1','https://example.com/#secret'])assert.throws(()=>publicOrigin(value,{}));
});
