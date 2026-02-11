import { db, fire } from './firebase-config.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- 1. CONFIGURACIÓN ---
const auth = getAuth();
const provider = new GoogleAuthProvider();
const MEALS = [ 
    { k: '01_desayuno', n: 'Desayuno', i: 'fa-coffee' }, 
    { k: '02_almuerzo', n: 'Almuerzo', i: 'fa-bread-slice' }, 
    { k: '03_comida', n: 'Comida', i: 'fa-utensils' }, 
    { k: '04_merienda', n: 'Merienda', i: 'fa-apple-alt' }, 
    { k: '05_cena', n: 'Cena', i: 'fa-moon' } 
];

// Estado Global
window.S = { d: new Date(), uid: null, u: null, day: {}, lib: [], platos: [], lastSearch: [], tm: null, item: null, edit: false, eIdx: null, srcMeal: null, copyMode: 'copy' };

// --- 2. SISTEMA ---
window.Sys = {
    init: async () => {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                ['v-login'].forEach(x=>document.getElementById(x).style.display='none');
                ['app-header','feed','fab-btn'].forEach(x=>document.getElementById(x).style.display='block');
                document.getElementById('fab-btn').style.display='flex';
                
                // Usamos el UID de Google como identificador único
                window.S.uid = user.uid;
                await window.Sys.load(user);
            } else {
                ['app-header','feed','fab-btn'].forEach(x=>document.getElementById(x).style.display='none');
                document.getElementById('v-login').style.display='flex';
                document.getElementById('loading-screen').style.display='none';
            }
        });
    },
    login: async () => { try { await signInWithPopup(auth, provider); } catch (e) { alert("Error login: " + e.message); } },
    logout: async () => { await signOut(auth); location.reload(); },
    
    load: async (user) => {
        try {
            await window.DB.lib();
            let uData = await window.DB.getU(user.uid);
            
            // Si no existe perfil, abrimos modal para crear
            if (!uData) {
                window.UI.openProfile();
                document.getElementById('e-name').value = user.displayName || 'Usuario';
                document.getElementById('loading-screen').style.display = 'none';
                return;
            }
            window.S.u = window.DB.norm(uData);
            window.Calc.bio();
            await window.DB.getPlates();
            await window.Sys.sync();
            document.getElementById('loading-screen').style.display = 'none';
            
            if(!window.S.day.weight) setTimeout(() => { window.Stats.open(); }, 2000);
        } catch(e) { console.error(e); }
    },
    sync: async () => { window.S.day = await window.DB.getDay(window.S.d); window.Render.all(); }
};

// --- 3. BASE DE DATOS ---
window.DB = {
    // Normalizamos: 'y' ahora será EDAD real, no año de nacimiento
    norm: (u) => ({ 
        id: u.uid, name: u.name, email: u.email, 
        h: parseFloat(u.height||170), w: parseFloat(u.weight||70), 
        y: parseInt(u.age||30), // Cambiado a 'age'
        g: u.gender||'male', act: u.activity||"1.2", mod: u.goalMod||"0", 
        mac: u.customMacros || {p:30, c:40, f:30} 
    }),
    setU: async (u) => { await fire.setDoc(fire.doc(db, 'usuarios', window.S.uid), u); },
    getU: async (id) => { const s = await fire.getDoc(fire.doc(db, 'usuarios', id)); return s.exists() ? s.data() : null; },
    getDay: async (d) => { 
        if(!window.S.uid) return {}; 
        const k = d.toISOString().split('T')[0]; 
        const s = await fire.getDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, k)); 
        let data = s.exists() ? s.data() : {}; 
        MEALS.forEach(m => { if (!data[m.k]) data[m.k] = [] }); return data; 
    },
    setDay: async () => { 
        if(!window.S.uid) return; 
        const k = window.S.d.toISOString().split('T')[0]; 
        await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, k), window.S.day); 
    },
    lib: async () => { const s = await fire.getDoc(fire.doc(db, 'sistema', 'biblioteca')); window.S.lib = s.exists() ? s.data().items : []; },
    getPlates: async () => { try { if(!window.S.uid) return; const s = await fire.getDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/platos`)); window.S.platos = s.exists() ? s.data().items : []; } catch (e) { window.S.platos = []; } },
    savePlates: async () => { if(!window.S.uid) return; await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/platos`), { items: window.S.platos }); }
};

// --- 4. UI ---
window.UI = {
    open: (id) => document.getElementById(id).style.display='flex',
    closeAll: () => document.querySelectorAll('.modal').forEach(m=>m.style.display='none'),
    view: (id) => { ['v-home','v-conf','v-qty','v-json','v-import'].forEach(x=>{ const el=document.getElementById(x); if(el) el.style.display='none'; }); document.getElementById(id).style.display='block'; },
    setQty: (i) => { document.getElementById('qty-name-in').value=i.n; document.getElementById('qty-in').value=i.q||100; document.getElementById('unit-in').value=i.u||'g'; },
    openProfile: () => {
        if(window.S.u) {
            const u = window.S.u;
            document.getElementById('e-name').value=u.name; document.getElementById('e-h').value=u.h; document.getElementById('e-w').value=u.w;
            document.getElementById('e-y').value=u.y; document.getElementById('e-g').value=u.g; document.getElementById('e-act').value=u.act; document.getElementById('e-mod').value=u.mod;
            if(u.mac) { document.getElementById('pp').value=u.mac.p; document.getElementById('pc').value=u.mac.c; document.getElementById('pf').value=u.mac.f; }
        }
        window.Calc.live(); window.UI.open('m-prof');
    }
};

// --- 5. CÁLCULOS (ACTUALIZADO) ---
window.Calc = {
    // Cálculo al cargar datos guardados
    bio: () => { 
        if(!window.S.u)return; 
        const {h, w, y, g, act, mod, mac} = window.S.u;
        // TMB: Calorías en coma (Fórmula Mifflin-St Jeor)
        let bmr = (10*w) + (6.25*h) - (5*y) + (g=='male'?5:-161); 
        
        // MANTENIMIENTO: TMB x Actividad
        const maintenance = Math.round(bmr * parseFloat(act));
        
        // META: Mantenimiento + Objetivo (ej. restar 500)
        const goal = maintenance + parseInt(mod);
        
        window.S.u.calc = { 
            goal: goal, 
            p: Math.round((goal*(mac.p/100))/4), 
            c: Math.round((goal*(mac.c/100))/4), 
            f: Math.round((goal*(mac.f/100))/9) 
        };
        document.getElementById('h-av').innerText = window.S.u.name[0].toUpperCase(); 
        // Mostramos Mantenimiento y Meta en la cabecera
        document.getElementById('bio-txt').innerText = `Mant: ${maintenance} | Meta: ${goal} kcal`; 
    },
    
    // Cálculo en vivo mientras editas el perfil
    live: () => {
        const v=(id)=>parseFloat(document.getElementById(id).value)||0; 
        const edad = v('e-y');
        // 1. TMB
        let bmr = (10*v('e-w')) + (6.25*v('e-h')) - (5*edad) + (document.getElementById('e-g').value=='male'?5:-161);
        // 2. Mantenimiento
        const maintenance = Math.round(bmr * v('e-act'));
        // 3. Meta
        const goal = maintenance + v('e-mod');
        
        // Actualizar la caja de datos del perfil
        document.getElementById('l-tmb').innerText = Math.round(bmr); 
        document.getElementById('l-maint').innerText = maintenance; // Nuevo dato
        document.getElementById('l-goal').innerText = goal;
        
        const h_m = v('e-h')/100;
        document.getElementById('l-imc').innerText = h_m > 0 ? (v('e-w')/(h_m*h_m)).toFixed(1) : '--';
    }
};

// --- 6. RENDER (REDISENADO: MACROS POR COMIDA Y BOTONES CLAROS) ---
window.Render = {
    all: () => {
        // --- 1. DATOS GENERALES ---
        document.getElementById('h-day').innerText = window.S.d.toLocaleDateString('es-ES', {weekday:'long'});
        document.getElementById('h-full').innerText = window.S.d.toLocaleDateString('es-ES');
        
        let t={k:0, p:0, c:0, f:0}; 
        Object.values(window.S.day).forEach(arr=>{if(Array.isArray(arr))arr.forEach(i=>{t.k+=i.k;t.p+=i.p;t.c+=i.c;t.f+=i.f;});});
        
        if(!window.S.u||!window.S.u.calc) return;
        
        // --- 2. BARRA SUPERIOR (Mant/Meta) ---
        const tg = window.S.u.calc; 
        const diff = tg.goal - t.k;
        const maintenance = tg.goal - parseInt(window.S.u.mod || 0);
        
        // Estilos Inline para asegurar que se vea bien
        const stBar = "display:flex; justify-content:center; gap:20px; font-weight:700; font-size:0.9rem; margin-bottom:10px;";
        const bioHtml = `
            <div style="${stBar}">
                <div style="color:#f59e0b; display:flex; align-items:center; gap:5px"><i class="fas fa-fire"></i> Mant: ${maintenance}</div>
                <div style="color:#ef4444; display:flex; align-items:center; gap:5px"><i class="fas fa-bullseye"></i> Meta: ${tg.goal}</div>
            </div>`;
        document.getElementById('bio-txt').innerHTML = bioHtml;

        // --- 3. ANILLO PRINCIPAL ---
        const ring = document.getElementById('ring-bg');
        if(diff < 0){
            document.getElementById('l-restan').innerText = "EXCESO";
            document.getElementById('v-rem').innerText = Math.abs(Math.round(diff));
            ring.style.background = `conic-gradient(#ef4444 0% 100%)`;
        } else {
            document.getElementById('l-restan').innerText = "RESTAN";
            document.getElementById('v-rem').innerText = Math.round(diff);
            const pct = Math.min((t.k/tg.goal)*100, 100);
            ring.style.background = `conic-gradient(#2563eb 0% ${pct}%, #10b981 ${pct}% 100%)`;
        }
        
        // Barras de progreso
        document.getElementById('v-p').innerText=`${Math.round(t.p)}/${Math.round(tg.p)}`; 
        document.getElementById('b-p').style.width=Math.min((t.p/tg.p)*100,100)+'%'; 
        document.getElementById('v-c').innerText=`${Math.round(t.c)}/${Math.round(tg.c)}`; 
        document.getElementById('b-c').style.width=Math.min((t.c/tg.c)*100,100)+'%'; 
        document.getElementById('v-f').innerText=`${Math.round(t.f)}/${Math.round(tg.f)}`; 
        document.getElementById('b-f').style.width=Math.min((t.f/tg.f)*100,100)+'%';

        // --- 4. RENDERIZADO DE COMIDAS (ESTILO TARJETA MODERNA) ---
        const feed = document.getElementById('feed'); 
        feed.innerHTML = '';
        
        MEALS.forEach(m => {
            const arr = window.S.day[m.k] || [];
            let mk=0, mp=0, mc=0, mf=0, rows='';
            
            // ESTILOS INLINE PARA LOS BOTONES (Asegura el color)
            const btnBase = "width:36px; height:36px; border-radius:10px; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:1rem; transition:0.2s; margin-left:5px;";
            const sPlate = btnBase + "background:#f3e8ff; color:#9333ea;"; // Morado
            const sCopy = btnBase + "background:#eff6ff; color:#2563eb;";  // Azul
            const sMove = btnBase + "background:#fff7ed; color:#ea580c;";  // Naranja
            const sDel = btnBase + "background:#fef2f2; color:#dc2626;";   // Rojo
            const sAdd = btnBase + "background:#ecfdf5; color:#16a34a; font-weight:bold;"; // Verde

            // ESTILOS PARA LAS PÍLDORAS DE MACROS
            const pillBase = "padding:4px 10px; border-radius:12px; font-size:0.8rem; font-weight:700; display:flex; align-items:center; gap:5px;";
            const pPro = pillBase + "background:#f3e8ff; color:#7c3aed;";
            const pCar = pillBase + "background:#e0f2fe; color:#0284c7;";
            const pFat = pillBase + "background:#ffedd5; color:#ea580c;";

            // Generar filas de alimentos
            arr.forEach((i, idx) => { 
                mk+=i.k; mp+=i.p; mc+=i.c; mf+=i.f;
                rows += `
                <div class="item" style="padding:12px; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;">
                    <div class="i-info">
                        <div style="font-weight:700; font-size:0.95rem; margin-bottom:4px; color:#0f172a">${i.n}</div>
                        <div style="display:flex; gap:10px; align-items:center; font-size:0.8rem; font-family:monospace; color:#64748b">
                            <span style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:700; color:#334155; border:1px solid #e2e8f0">${i.q}${i.u}</span>
                            <span>🔥${Math.round(i.k)}</span>
                            <span style="color:#7c3aed; font-weight:600">P${Math.round(i.p)}</span>
                            <span style="color:#0284c7; font-weight:600">C${Math.round(i.c)}</span>
                            <span style="color:#ea580c; font-weight:600">F${Math.round(i.f)}</span>
                        </div>
                    </div>
                    <div class="c-actions" style="display:flex; gap:5px;">
                        <button style="width:32px; height:32px; border:1px solid #e2e8f0; background:white; border-radius:8px; color:#f59e0b; cursor:pointer;" onclick="window.Logic.openItemAct('${m.k}',${idx})">⇄</button>
                        <button style="width:32px; height:32px; border:1px solid #e2e8f0; background:white; border-radius:8px; color:#64748b; cursor:pointer;" onclick="window.Logic.editItem('${m.k}',${idx})">✏️</button>
                        <button style="width:32px; height:32px; border:1px solid #fee2e2; background:white; border-radius:8px; color:#ef4444; cursor:pointer;" onclick="window.Logic.delItem('${m.k}',${idx})">🗑️</button>
                    </div>
                </div>`; 
            });
            
            // CABECERA COLORIDA Y MODERNA
            const mealHeader = `
                <div class="c-head" style="padding:15px; background:white; border-bottom:1px solid #f1f5f9;">
                    <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                        <div style="font-size:1.1rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:8px;">
                            <i class="fas ${m.i}"></i> ${m.n}
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <span style="${pPro}">Prot ${Math.round(mp)}g</span>
                            <span style="${pCar}">Carb ${Math.round(mc)}g</span>
                            <span style="${pFat}">Gras ${Math.round(mf)}g</span>
                        </div>
                    </div>
                    
                    <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px;">
                        <span style="background:#0f172a; color:white; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.9rem;">${Math.round(mk)} kcal</span>
                        
                        <div style="display:flex;">
                            <button style="${sPlate}" onclick="window.Logic.openCreatePlate('${m.k}')" title="Crear Plato"><i class="fas fa-utensils"></i></button>
                            <button style="${sCopy}" onclick="window.Logic.openCopy('${m.k}','copy')" title="Copiar"><i class="fas fa-copy"></i></button>
                            <button style="${sMove}" onclick="window.Logic.openCopy('${m.k}','move')" title="Mover"><i class="fas fa-calendar-alt"></i></button>
                            <button style="${sDel}" onclick="window.Logic.wipeMeal('${m.k}')" title="Vaciar"><i class="fas fa-trash-alt"></i></button>
                            <button style="${sAdd}" onclick="window.Logic.openAdd('${m.k}')"><i class="fas fa-plus"></i></button>
                        </div>
                    </div>
                </div>`;
                
            feed.innerHTML += `<div class="card" style="background:white; border-radius:16px; margin-bottom:20px; box-shadow:0 4px 15px rgba(0,0,0,0.05); overflow:hidden; border:1px solid #e2e8f0;">${mealHeader}<div>${rows}</div></div>`;
        });
    }
};

// --- 7. LOGIC ---
window.Logic = {
    day: (n) => { window.S.d.setDate(window.S.d.getDate() + n); window.Sys.sync(); },
    autoSave: async () => { await window.DB.setDay(); window.Render.all(); },
    saveUser: async () => {
        const n=document.getElementById('e-name').value; if(!n) return alert("Nombre obligatorio");
        try {
            const val=(id)=>parseFloat(document.getElementById(id).value);
            // Guardamos 'age' en lugar de 'birthYear' para evitar confusiones
            const u={ 
                uid: window.S.uid, name:n, email:auth.currentUser.email, 
                height:val('e-h'), weight:val('e-w'), age:val('e-y'), 
                gender:document.getElementById('e-g').value, activity:document.getElementById('e-act').value, goalMod:val('e-mod'), 
                customMacros:{p:val('pp'), c:val('pc'), f:val('pf')} 
            };
            await window.DB.setU(u); 
            alert("✅ Perfil Actualizado"); 
            window.S.u=window.DB.norm(u); window.Calc.bio(); window.UI.closeAll();
        } catch (e) { alert("Error: "+e.message); }
    },
    
    openAdd: (mk)=>{window.S.tm=mk;window.S.edit=false;window.UI.view('v-home');window.UI.open('m-add');if(window.S.lib.length>0)window.Logic.search();},
    search: ()=>{const q=document.getElementById('src-in').value.toLowerCase();const b=document.getElementById('res-list');b.innerHTML='';const res=[...window.S.platos.filter(x=>x.n.toLowerCase().includes(q)).map(p=>({...p,isPlate:true})), ...window.S.lib.filter(x=>x.n.toLowerCase().includes(q))]; res.forEach((f,i)=>{b.innerHTML+=`<div class="food-suggestion" onclick="window.selectFoundItem(${i})"><b>${f.n}</b> <small>${Math.round(f.k)}</small></div>`}); window.S.lastSearch=res;},
    saveItem: async ()=>{const q=parseFloat(document.getElementById('qty-in').value), u=document.getElementById('unit-in').value, n=document.getElementById('qty-name-in').value; const b=window.S.item, f=q/100; const ent={n:n,q:q,u:u,k:b.k*f,p:b.p*f,c:b.c*f,f:b.f*f}; if(window.S.edit)window.S.day[window.S.tm][window.S.eIdx]=ent; else window.S.day[window.S.tm].push(ent); await window.DB.setDay(); window.UI.closeAll(); window.Sys.sync();},
    editItem: (mk,i)=>{window.S.edit=true;window.S.tm=mk;window.S.eIdx=i;window.S.item=JSON.parse(JSON.stringify(window.S.day[mk][i]));window.UI.setQty(window.S.item);window.UI.view('v-qty');window.UI.open('m-add');},
    delItem: async (mk,i)=>{if(confirm("Borrar?")){window.S.day[mk].splice(i,1);await window.DB.setDay();window.Sys.sync();}},
    // Añadir dentro de window.Logic = { ... }
    delMeal: async (mk) => {
        if(confirm(`¿Vaciar todo el ${mk.split('_')[1]}?`)){
            window.S.day[mk] = []; // Vacía el array de alimentos de esa comida
            await window.DB.setDay(); // Guarda los cambios
            window.Sys.sync(); // Actualiza la pantalla
        }
    },
    
    openCopy: (mk,t)=>{window.S.srcMeal=mk;window.S.copyMode=t;document.getElementById('copy-date').valueAsDate=window.S.d;document.getElementById('copy-meal').value=mk;window.UI.open('m-copy');},
    execCopy: async ()=>{const d=document.getElementById('copy-date').value, tm=document.getElementById('copy-meal').value; const r=fire.doc(db,`usuarios/${window.S.uid}/diario`,d); const s=await fire.getDoc(r); let da=s.exists()?s.data():{}; if(!da[tm])da[tm]=[]; da[tm]=da[tm].concat(window.S.day[window.S.srcMeal]); await fire.setDoc(r,da); if(window.S.copyMode=='move'){window.S.day[window.S.srcMeal]=[];await window.DB.setDay();} window.UI.closeAll(); if(d===window.S.d.toISOString().split('T')[0]) window.Sys.sync(); alert("Hecho");},
    openItemAct: (mk,i)=>{window.S.tm=mk;window.S.eIdx=i;window.S.item=window.S.day[mk][i];document.getElementById('ia-name').innerText=window.S.item.n;document.getElementById('ia-date').valueAsDate=window.S.d;document.getElementById('ia-meal').value=mk;window.UI.open('m-item-act');},
    execItemAct: async (mode)=>{const d=document.getElementById('ia-date').value, tm=document.getElementById('ia-meal').value; let td=(d===window.S.d.toISOString().split('T')[0])?window.S.day:(await fire.getDoc(fire.doc(db,`usuarios/${window.S.uid}/diario`,d))).data()||{}; if(!td[tm])td[tm]=[]; td[tm].push(window.S.item); if(mode=='move')window.S.day[window.S.tm].splice(window.S.eIdx,1); await fire.setDoc(fire.doc(db,`usuarios/${window.S.uid}/diario`,d),td); await window.DB.setDay(); window.UI.closeAll(); window.Sys.sync();},

    openCreatePlate: (mk)=>{window.S.srcMeal=mk;const c=document.getElementById('plate-ingredients-list');c.innerHTML='';window.S.day[mk].forEach((it,i)=>{c.innerHTML+=`<div class="plate-check-row"><span>${it.n}</span><input type="checkbox" value="${i}" checked></div>`});window.UI.open('m-create-plate');},
    savePlateToDb: async ()=>{const n=document.getElementById('plate-name').value; const chk=document.querySelectorAll('#plate-ingredients-list input:checked'); let its=[],tk=0,tp=0,tc=0,tf=0; chk.forEach(c=>{const i=window.S.day[window.S.srcMeal][c.value]; its.push(i); tk+=i.k;tp+=i.p;tc+=i.c;tf+=i.f;}); window.S.platos.push({n:n,k:tk,p:tp,c:tc,f:tf,items:its}); await window.DB.savePlates(); window.UI.closeAll(); alert("Plato creado");},

    pdf: () => { window.UI.closeAll(); const d=window.S.d.toLocaleDateString(); let h=`<h1>Dieta ${d}</h1>`; MEALS.forEach(m=>{const a=window.S.day[m.k]||[]; if(a.length){h+=`<h3>${m.n}</h3><ul>`;a.forEach(i=>h+=`<li>${i.n} - ${Math.round(i.k)}kcal</li>`);h+='</ul>';}}); const el=document.createElement('div');el.innerHTML=h;html2pdf().from(el).save(`Dieta_${d}.pdf`); },
    importJSON: async (inp) => { const f=inp.files[0]; if(!f)return; const r=new FileReader(); r.onload=async(e)=>{ try{const d=JSON.parse(e.target.result); const h=d.historial||d; if(!confirm(`Importar ${Object.keys(h).length} días?`))return; const b=fire.writeBatch(db); Object.entries(h).forEach(([k,v])=>{if(k.match(/^\d{4}-\d{2}-\d{2}$/)) b.set(fire.doc(db,`usuarios/${window.S.uid}/diario`,k),v)}); await b.commit(); alert("✅ Importado"); location.reload(); }catch(err){alert("Error JSON");} }; r.readAsText(f); },
    exportJSON: async () => { const s=await fire.getDocs(fire.collection(db,`usuarios/${window.S.uid}/diario`)); const d={}; s.forEach(doc=>d[doc.id]=doc.data()); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(d)],{type:'application/json'})); a.download=`Backup.json`; a.click(); }
};

// --- 8. STATS (MEJORADO Y PROTEGIDO) ---
window.Stats = {
    chartDaily: null, chartWeekly: null, chartWeight: null,
    
    open: () => { 
        window.S.d = new Date(); 
        window.UI.open('m-stats'); 
        // Pequeño retardo para dar tiempo a que se abra el modal antes de pintar
        setTimeout(window.Stats.updateView, 200); 
    },
    changeDate: (d) => { window.S.d.setDate(window.S.d.getDate()+d); window.Stats.updateView(); },
    load: (d) => { if(d) window.S.d=new Date(d); window.Stats.updateView(); },
    
    saveWeight: async () => { 
        let val = parseFloat(document.getElementById('w-today').value); 
        if(!val) return; // Si no hay número, no hace nada
        
        const dStr = window.S.d.toISOString().split('T')[0];
        const ref = fire.doc(db, `usuarios/${window.S.uid}/diario`, dStr);
        
        // Guardar en Firebase de forma segura
        const snap = await fire.getDoc(ref); 
        let data = snap.exists() ? snap.data() : {}; 
        data.weight = val;
        await fire.setDoc(ref, data); 
        
        // Actualizar dato local si es hoy
        if (dStr === window.S.d.toISOString().split('T')[0]) window.S.day.weight = val;
        
        alert("Peso guardado"); 
        window.Stats.updateView();
    },

    updateView: async () => {
        try {
            const dStr = window.S.d.toISOString().split('T')[0]; 
            document.getElementById('st-date').value = dStr;
            
            // 1. Cargar historial completo
            const q = await fire.getDocs(fire.query(fire.collection(db, `usuarios/${window.S.uid}/diario`), fire.orderBy('__name__')));
            const hist = []; 
            q.forEach(x => hist.push({id:x.id, ...x.data()}));
            
            const cur = hist.find(x => x.id === dStr); 
            document.getElementById('w-today').value = cur ? cur.weight : '';
            
            // --- LÓGICA DE PESO (2 DECIMALES + COMPARATIVAS) ---
            const fb = document.getElementById('w-feedback'); 
            let html = '';
            
            // A) Peso Inicial: Busca el primero que tenga dato, o usa 84.51 por defecto
            let firstW = 84.51; 
            const firstRec = hist.find(h => h.weight > 0);
            if(firstRec) firstW = firstRec.weight;

            // B) Peso Anterior: El último registrado antes de hoy
            let prevW = null;
            for(let i = hist.length-1; i >= 0; i--){ 
                if(hist[i].id < dStr && hist[i].weight){ prevW = hist[i].weight; break; } 
            }
            
            let currW = cur ? cur.weight : null;
            
            if(currW) {
                const diff = (actual, base) => { 
                    const d = actual - base; 
                    // Verde si bajas (negativo), Rojo si subes (positivo)
                    const col = d > 0 ? '#ef4444' : '#10b981'; 
                    const sign = d > 0 ? '+' : '';
                    return `<b style="color:${col}">${sign}${d.toFixed(2)}kg</b>`; 
                };
                
                if(prevW) html += `<div style="text-align:center">Vs Anterior<br>${diff(currW, prevW)}</div>`;
                html += `<div style="text-align:center">Vs Inicio (${firstW})<br>${diff(currW, firstW)}</div>`;
            } else {
                html = '<small style="color:#94a3b8">Introduce tu peso para ver estadísticas</small>';
            }
            fb.innerHTML = html;

            // --- GRÁFICA DIARIA (DONUT AZUL vs ROJO) ---
            let dayCal = 0; 
            if(cur) MEALS.forEach(m => { if(cur[m.k]) cur[m.k].forEach(i => dayCal += i.k); });
            
            const goal = window.S.u.calc.goal;
            const diffCal = goal - dayCal;
            const isOver = diffCal < 0;

            let cData, cBg, txtHtml;
            
            if(!isOver) {
                // NO te has pasado: Azul (Comido) + Gris (Lo que falta)
                cData = [dayCal, diffCal]; 
                cBg = ['#3b82f6', '#e2e8f0'];
                txtHtml = `<span style="color:#3b82f6;font-size:1.2rem;font-weight:800">${Math.round(dayCal)}</span><br><small>de ${goal}</small>`;
            } else {
                // TE HAS PASADO: Azul (Meta cumplida) + Rojo (Exceso)
                cData = [goal, Math.abs(diffCal)]; 
                cBg = ['#3b82f6', '#ef4444'];
                txtHtml = `<span style="color:#ef4444;font-size:1.2rem;font-weight:800">+${Math.round(Math.abs(diffCal))}</span><br><small>Exceso</small>`;
            }

            if(window.Stats.chartDaily) window.Stats.chartDaily.destroy();
            window.Stats.chartDaily = new Chart(document.getElementById('chart-daily'), { 
                type:'doughnut', 
                data:{ labels:['Base','Resto/Exceso'], datasets:[{data:cData, backgroundColor:cBg, borderWidth:0}] }, 
                options:{ cutout:'75%', plugins:{legend:{display:false}}, animation: {duration: 500} } 
            });
            document.getElementById('daily-txt').innerHTML = txtHtml;

            // --- GRÁFICA SEMANAL ---
            // Calcular inicio de semana (Lunes)
            const dObj = new Date(window.S.d); 
            const dayNum = dObj.getDay() || 7; 
            dObj.setDate(dObj.getDate() - dayNum + 1);
            
            let wCal = 0;
            // Sumar los 7 días desde el lunes
            for(let i=0; i<7; i++) {
                const tempD = new Date(dObj); 
                tempD.setDate(dObj.getDate()+i);
                const k = tempD.toISOString().split('T')[0];
                const h = hist.find(x => x.id === k);
                if(h) MEALS.forEach(m => { if(h[m.k]) h[m.k].forEach(x => wCal += x.k) });
            }
            
            const wGoal = goal * 7;
            const wDiff = wGoal - wCal;
            const wIsOver = wDiff < 0;
            const wBg = wIsOver ? ['#3b82f6', '#ef4444'] : ['#8b5cf6', '#e2e8f0']; // Violeta si va bien, Rojo si mal
            
            if(window.Stats.chartWeekly) window.Stats.chartWeekly.destroy();
            window.Stats.chartWeekly = new Chart(document.getElementById('chart-weekly'), { 
                type:'doughnut', 
                data:{ datasets:[{data:[wCal, Math.max(0, Math.abs(wDiff))], backgroundColor:wBg, borderWidth:0}] }, 
                options:{ cutout:'75%', plugins:{legend:{display:false}} } 
            });
            document.getElementById('weekly-txt').innerHTML = `<span class="srt-val">${Math.round(wCal)}</span><span class="srt-lbl">Semanal</span>`;

            // --- GRÁFICA PESO (LÍNEA EVOLUTIVA) ---
            const cD=[], cW=[]; 
            // Solo cogemos los días que tengan peso registrado (últimos 15)
            const wHist = hist.filter(h => h.weight > 0).slice(-15);
            
            wHist.forEach(h => { 
                cD.push(h.id.slice(5)); // Día-Mes
                cW.push(h.weight); 
            });

            if(window.Stats.chartWeight) window.Stats.chartWeight.destroy();
            window.Stats.chartWeight = new Chart(document.getElementById('chart-weight'), { 
                type:'line', 
                data:{ 
                    labels:cD, 
                    datasets:[{ 
                        data:cW, 
                        borderColor:'#10b981', 
                        backgroundColor:'rgba(16,185,129,0.1)', 
                        tension:0.3, 
                        fill:true, 
                        pointRadius:4,
                        pointBackgroundColor: '#10b981'
                    }] 
                }, 
                options:{ 
                    plugins:{legend:{display:false}}, 
                    maintainAspectRatio:false,
                    scales: { y: { ticks: { callback: function(val) { return val.toFixed(1); } } } }
                } 
            });

        } catch(e) { 
            console.error("Error Stats:", e); 
            // Esto evita la pantalla blanca, solo mostrará un aviso si algo falla mucho
        }
    }
};

// --- ARRANQUE ---
window.selectFoundItem = (i) => { const s=window.S.lastSearch[i]; if(s.isPlate){if(confirm("Añadir?")){s.items.forEach(it=>window.S.day[window.S.tm].push(it));window.Logic.autoSave();}} else {window.S.item=s;window.UI.setQty(s);window.UI.view('v-qty');} };
if (document.readyState === 'complete') window.Sys.init(); else window.addEventListener('load', window.Sys.init);