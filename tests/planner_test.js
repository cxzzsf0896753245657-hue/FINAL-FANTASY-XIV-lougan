const fs=require('fs');
global.self=global;
global.fetch=async(p)=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(__dirname + '/../'+p,'utf8'))});
require(__dirname + '/../js/data.js');
require(__dirname + '/../js/planner.js');
const assert = require('assert');
(async()=>{
  await FF.loadData('data/');
  const D=FF.D;
  const sub=FF.search('鯊魚級船體')[0];
  const list={items:[{id:sub.item.id,qty:1}],stock:{},buy:{},pick:{},done:{}};
  const r1=FF.computeMaterials(list);
  console.log('roots',r1.roots.length,'semis',r1.semis.length,'raws',r1.raws.length,'crafts',r1.craftCount,'gil',r1.gil);
  console.log(FF.groupByCat(r1.raws).map(([c,l])=>c+':'+l.length).join(' '));
  // 勾選一個半成品 → 底下素材應減少
  const semi=r1.semis.find(n=>n.producer.type==='recipe');
  list.done['c'+semi.id]=true;
  const r2=FF.computeMaterials(list);
  const s2=r2.semis.find(n=>n.id===semi.id);
  assert.strictEqual(s2.net,0); assert.strictEqual(s2.total, semi.total);
  const ing=semi.producer.ings[0][0];
  const before=(r1.raws.concat(r1.semis)).find(n=>n.id===ing), after=(r2.raws.concat(r2.semis)).find(n=>n.id===ing);
  console.log('done',semi.item.name,'→',before.item.name,before.net,'→',after.net);
  assert(after.net < before.net);
  // 勾選成品 → 全部歸零
  list.done['c'+sub.item.id]=true;
  const r3=FF.computeMaterials(list);
  assert(r3.raws.every(n=>n.net===0) && r3.craftCount===0);
  console.log('sets',D.sets.length, D.sets.slice(0,4).map(s=>s.name+'/'+s.role+'/'+s.items.length));
  console.log('OK');
})();
