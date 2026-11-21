const fs=require('fs');
global.self=global; 
global.fetch=async(p)=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(__dirname + '/../'+p,'utf8'))});
require(__dirname + '/../js/data.js');
require(__dirname + '/../js/planner.js');
(async()=>{
  await FF.loadData('data/');
  const D=FF.D;
  console.log('search 鯊魚', FF.search('鯊魚').map(e=>e.item.name+(e.fc?'(FC)':'')).slice(0,12));
  console.log('search 鐵錠', FF.search('鐵錠').slice(0,5).map(e=>e.item.name+' '+e.recipes.map(r=>D.jobs[r.job]+r.level).join('/')));
  const sub=FF.search('鯊魚級船體')[0];
  const ing=[{id:sub.item.id,qty:1}];
  let t=Date.now();
  const res=FF.computeMaterials({items:ing,stock:{},buy:{},pick:{}});
  console.log('ms',Date.now()-t,'raw',res.raw.length,'crafts',res.crafts.length,'gil',res.gil);
  console.log(FF.craftsText(res).split('\n').slice(0,8).join('\n'));
  console.log(FF.materialsText(res).split('\n').slice(0,14).join('\n'));
  // 一般物品 + 庫存
  const it=FF.search('鋼鐵錠')[0];
  const r2=FF.computeMaterials({items:[{id:it.item.id,qty:5}],stock:{},buy:{},pick:{}});
  console.log(it.item.name, FF.craftsText(r2), '\n', FF.materialsText(r2));
})();
