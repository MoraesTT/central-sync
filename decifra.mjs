// uso: node decifra.mjs <inbox.enc.json> <chave_privada.pem> <saida.json>
import fs from 'node:fs'; import crypto from 'node:crypto';
const [f,p,o]=process.argv.slice(2); const e=JSON.parse(fs.readFileSync(f,'utf8'));
const k=crypto.privateDecrypt({key:fs.readFileSync(p,'utf8'),padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(e.k,'base64'));
const d=crypto.createDecipheriv('aes-256-gcm',k,Buffer.from(e.iv,'base64')); d.setAuthTag(Buffer.from(e.tag,'base64'));
fs.writeFileSync(o,Buffer.concat([d.update(Buffer.from(e.data,'base64')),d.final()])); console.log('OK',e.at,e.n);
