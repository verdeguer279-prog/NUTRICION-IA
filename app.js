import { db, fire } from './firebase-config.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- 1. CONFIGURACIÓN ---
const auth = getAuth();
const provider = new GoogleAuthProvider();
const APP_NAME = "Nutr-IA";

setTimeout(() => { const s = document.getElementById('loading-screen'); if (s && s.style.display != 'none') s.style.display = 'none'; }, 4000);

const MEALS = [ { k: '01_desayuno', n: 'Desayuno', i: 'fa-coffee' }, { k: '02_almuerzo', n: 'Almuerzo', i: 'fa-bread-slice' }, { k: '03_comida', n: 'Comida', i: 'fa-utensils' }, { k: '04_merienda', n: 'Merienda', i: 'fa-apple-alt' }, { k: '05_cena', n: 'Cena', i: 'fa-moon' } ];

window.S = { d: new Date(), uid: null, u: null, day: {}, lib: [], platos: [], allUsers: [], tm: null, item: null, edit: false, eIdx: null, srcMeal: null, copyMode: 'copy', lastSearch: [], plateEditIdx: -1, editLibItem: null, editLib: false };

// --- 2. SISTEMA ---
window.Sys = {
    init: async () => {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                ['v-login'].forEach(x=>document.getElementById(x).style.display='none');
                ['app-header','feed','fab-btn'].forEach(x=>document.getElementById(x).style.display='block');
                document.getElementById('fab-btn').style.display='flex';
                
                let dbId = user.uid; 
                try {
                    const q = fire.query(fire.collection(db, 'usuarios'), fire.where('uid', '==', user.uid));
                    const querySnapshot = await fire.getDocs(q);
                    if (!querySnapshot.empty) dbId = querySnapshot.docs[0].id; 
                } catch(e) { console.log("Login fallback UID"); }

                window.S.uid = dbId; 
                await window.Sys.load(dbId, user.email, user.displayName);
            } else {
                ['app-header','feed','fab-btn'].forEach(x=>document.getElementById(x).style.display='none');
                document.getElementById('v-login').style.display='flex';
                document.getElementById('loading-screen').style.display='none';
            }
        });
    },
    login: async () => { try { await signInWithPopup(auth, provider); } catch (e) { alert(`Error login: ${e.message}`); } },
    logout: async () => { await signOut(auth); location.reload(); },
    
    load: async (id, email, name) => {
        try {
            await window.DB.lib();
            let uData = await window.DB.getU(id);
            if (!uData) {
                window.UI.newProfile();
                const cleanName = name || 'Usuario';
                document.getElementById('e-name').value = cleanName;
                document.getElementById('e-name').readOnly = false;
                document.getElementById('e-name').style.opacity = "1";
                document.getElementById('e-name').style.cursor = "text";
                document.getElementById('loading-screen').style.display = 'none';
                return;
            }
            window.S.u = window.DB.norm(uData);
            window.Calc.bio();
            await window.DB.getPlates();
            await window.Sys.sync();
            document.getElementById('loading-screen').style.display = 'none';
            if(!window.S.day.weight) setTimeout(() => { window.Stats.open(); }, 1500);
        } catch(e) { console.error("Load error:", e); }
    },
    sync: async () => { window.S.day = await window.DB.getDay(window.S.d); window.Render.all(); }
};

// --- 3. BASE DE DATOS ---
window.DB = {
    col: (n) => fire.collection(db, n),
    doc: (p, i) => fire.doc(db, p, i),
    norm: (u) => ({ id: u.name||u.uid, name: u.name||'Usuario', email: u.email, h: parseFloat(u.h||170), w: parseFloat(u.w||70), y: parseInt(u.y||1990), g: u.g||'male', act: u.act||"1.2", mod: u.mod||"0", mac: u.customMacros || {p:null, c:null, f:null} }),
    setU: async (u) => {
        await fire.setDoc(fire.doc(db, 'usuarios', u.name), u);
        window.S.uid = u.name; 
    },
    getU: async (id) => { const s = await fire.getDoc(fire.doc(db, 'usuarios', id)); return s.exists() ? s.data() : null; },
    getDay: async (d) => { if(!window.S.uid) return {}; const k = d.toISOString().split('T')[0]; const s = await fire.getDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, k)); let data = s.exists() ? s.data() : {}; MEALS.forEach(m => { if (!data[m.k]) data[m.k] = [] }); return data; },
    setDay: async () => { if(!window.S.uid) return; const k = window.S.d.toISOString().split('T')[0]; await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, k), window.S.day); },
    lib: async () => { const s = await fire.getDoc(window.DB.doc('sistema', 'biblioteca')); window.S.lib = s.exists() ? s.data().items : []; },
    saveLib: async () => { await fire.setDoc(window.DB.doc('sistema', 'biblioteca'), { items: window.S.lib }); },
    getPlates: async () => { try { if(!window.S.uid) return; const s = await fire.getDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/platos`)); window.S.platos = s.exists() ? s.data().items : []; } catch (e) { window.S.platos = []; } },
    savePlates: async () => { if(!window.S.uid) return; await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/platos`), { items: window.S.platos }); }
};

// --- 4. UI ---
window.UI = {
    open: (id) => document.getElementById(id).style.display='flex',
    closeAll: () => document.querySelectorAll('.modal').forEach(m=>m.style.display='none'),
    view: (id) => { ['v-home','v-conf','v-qty','v-json','v-import'].forEach(x=>document.getElementById(x).style.display='none'); document.getElementById(id).style.display='block'; },
    checkAI: () => { const k=localStorage.getItem('t_ai_key'); if(k)document.getElementById('btn-config-ai').classList.add('configured'); document.getElementById('ai-key').value=k||''; },
    setQty: (i) => { 
        document.getElementById('qty-name-in').value=i.n; document.getElementById('qty-in').value=i.q; document.getElementById('unit-in').value=i.u; 
        // Si estamos editando LIB (base de datos)
        if(window.S.editLib) {
            document.getElementById('qty-title').innerText = "Editar Alimento Base";
            document.getElementById('lib-edit-section').style.display='block';
            document.getElementById('lib-k').value = i.k || 0; 
            document.getElementById('lib-p').value = i.p || 0; 
            document.getElementById('lib-c').value = i.c || 0; 
            document.getElementById('lib-f').value = i.f || 0;
        } else { 
            // Si estamos añadiendo/editando al diario
            document.getElementById('qty-title').innerText = window.S.edit ? "Editar Cantidad" : "Añadir";
            document.getElementById('lib-edit-section').style.display='none'; 
            window.Logic.updateCalories(); 
        }
    },
    openProfile: () => {
        if(!window.S.u) return; const u=window.S.u;
        document.getElementById('e-name').value=u.name; document.getElementById('e-h').value=u.h; document.getElementById('e-w').value=u.w;
        document.getElementById('e-y').value=u.y; 
        document.getElementById('e-g').value=u.g; document.getElementById('e-act').value=u.act; document.getElementById('e-mod').value=u.mod;
        let pp=30, pc=50, pf=20;
        if(u.mac && u.mac.p) { const goal=u.calc.goal; if(goal>0) { pp=Math.round((u.mac.p*4/goal)*100); pc=Math.round((u.mac.c*4/goal)*100); pf=Math.round((u.mac.f*9/goal)*100); } }
        document.getElementById('pp').value=pp; document.getElementById('pc').value=pc; document.getElementById('pf').value=pf;
        window.Calc.live(); window.UI.open('m-prof');
    },
    newProfile: () => { window.S.u=null; document.querySelectorAll('#m-prof input').forEach(i=>i.value=''); window.UI.open('m-prof'); }
};

// --- 5. CALC ---
window.Calc = {
    bio: () => { 
        if(!window.S.u)return; 
        const h=window.S.u.h, w=window.S.u.w;
        const year = window.S.u.y || 1990; 
        const age = new Date().getFullYear() - year;
        
        let bmr = (10*w) + (6.25*h) - (5*age) + (window.S.u.g=='male'?5:-161);
        const maintenance = Math.round(bmr * parseFloat(window.S.u.act));
        const goal = maintenance + parseInt(window.S.u.mod);
        
        window.S.u.calc = { goal: goal, maintenance: maintenance }; 
        if(!window.S.u.mac.p){
            window.S.u.calc.p=Math.round(w*2); window.S.u.calc.f=Math.round(w*0.9); window.S.u.calc.c=Math.round((goal-(window.S.u.calc.p*4)-(window.S.u.calc.f*9))/4);
        } else window.S.u.calc = Object.assign(window.S.u.calc, window.S.u.mac);
        
        window.Render.all();
    },
    live: () => {
        const val=(id)=>parseFloat(document.getElementById(id).value)||0; 
        const h=val('e-h'), w=val('e-w'), year=val('e-y'); 
        const act=val('e-act'), mod=val('e-mod'); 
        const g=document.getElementById('e-g').value; 
        const pp=val('pp'), pc=val('pc'), pf=val('pf');
        
        document.getElementById('p-check').innerText=`Total: ${pp+pc+pf}% `+(pp+pc+pf===100?'✅':'⚠️');
        if(h && w && year > 1900) {
            const age = new Date().getFullYear() - year;
            const bmr = (10*w) + (6.25*h) - (5*age) + (g=='male'?5:-161);
            const maintenance = Math.round(bmr * act);
            const goal = maintenance + mod; 
            const imc = w/((h/100)**2); 
            
            document.getElementById('l-tmb').innerText = Math.round(bmr); 
            document.getElementById('l-maint').innerText = maintenance;
            document.getElementById('l-imc').innerText = imc.toFixed(1); 
            document.getElementById('l-goal').innerText = goal;
        }
    }
};

// --- 6. RENDER ---
window.Render = {
    all: () => {
        document.getElementById('h-day').innerText = window.S.d.toLocaleDateString('es-ES', {weekday:'long'});
        document.getElementById('h-full').innerText = window.S.d.toLocaleDateString('es-ES');
        let t={k:0, p:0, c:0, f:0}; Object.values(window.S.day).forEach(arr=>{if(Array.isArray(arr))arr.forEach(i=>{t.k+=i.k;t.p+=i.p;t.c+=i.c;t.f+=i.f;});});
        
        if(!window.S.u||!window.S.u.calc)return;
        
        const tg = window.S.u.calc; 
        const diff = tg.goal - t.k;
        const maintenance = tg.maintenance || tg.goal;
        
        const bioHtml = `
            <div class="top-stat-bar" style="display:flex; justify-content:center; gap:20px; font-weight:700; font-size:0.9rem; margin-bottom:10px;">
                <div style="color:#f59e0b; display:flex; align-items:center; gap:5px"><i class="fas fa-fire"></i> Mant: ${maintenance}</div>
                <div style="color:#ef4444; display:flex; align-items:center; gap:5px"><i class="fas fa-bullseye"></i> Meta: ${tg.goal}</div>
            </div>`;
        document.getElementById('bio-txt').innerHTML = bioHtml;

        const ring = document.getElementById('ring-bg'), lbl=document.getElementById('l-restan'), val=document.getElementById('v-rem');
        if(diff<0){
            ring.classList.add('danger'); lbl.innerText="EXCESO"; val.innerText=Math.abs(Math.round(diff));
            ring.style.background=`conic-gradient(#ef4444 0% 100%)`;
        } else {
            ring.classList.remove('danger'); lbl.innerText="RESTAN"; val.innerText=Math.round(diff);
            const pct=Math.min((t.k/tg.goal)*100,100);
            ring.style.background=`conic-gradient(#2563eb 0% ${pct}%, #10b981 ${pct}% 100%)`;
        }
        
        document.getElementById('v-p').innerText=`${Math.round(t.p)}/${Math.round(tg.p)}`; document.getElementById('b-p').style.width=Math.min((t.p/tg.p)*100,100)+'%'; 
        document.getElementById('v-c').innerText=`${Math.round(t.c)}/${Math.round(tg.c)}`; document.getElementById('b-c').style.width=Math.min((t.c/tg.c)*100,100)+'%'; 
        document.getElementById('v-f').innerText=`${Math.round(t.f)}/${Math.round(tg.f)}`; document.getElementById('b-f').style.width=Math.min((t.f/tg.f)*100,100)+'%';
        
        const feed=document.getElementById('feed'); feed.innerHTML='';
        MEALS.forEach(m => {
            const arr=window.S.day[m.k]||[]; let mk=0,mp=0,mc=0,mf=0,rows='';
            
            const btnBase = "width:36px; height:36px; border-radius:10px; border:1px solid transparent; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:1rem; margin-left:5px; transition:0.2s;";
            const sPlate = btnBase + "background:#f3e8ff; border-color:#d8b4fe; color:#9333ea;";
            const sCopy = btnBase + "background:#eff6ff; border-color:#bfdbfe; color:#2563eb;";
            const sMove = btnBase + "background:#fff7ed; border-color:#fde68a; color:#ea580c;";
            const sDel = btnBase + "background:#fef2f2; border-color:#fca5a5; color:#dc2626;";
            const sAdd = btnBase + "background:#ecfdf5; border-color:#86efac; color:#16a34a; font-weight:bold;";
            const pillBase = "padding:4px 10px; border-radius:12px; font-size:0.8rem; font-weight:700; display:flex; align-items:center; gap:5px;";
            const pPro = pillBase + "background:#f3e8ff; color:#7c3aed;";
            const pCar = pillBase + "background:#e0f2fe; color:#0284c7;";
            const pFat = pillBase + "background:#ffedd5; color:#ea580c;";

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
            
            const mealHeader = `
                <div class="c-head" style="padding:15px; background:white; border-bottom:1px solid #f1f5f9;">
                    <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                        <div style="font-size:1.1rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:8px;"><i class="fas ${m.i}"></i> ${m.n}</div>
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
            const u={ 
                uid:window.S.uid, name:n, email:auth.currentUser.email, 
                h:val('e-h'), w:val('e-w'), y:val('e-y'), 
                g:document.getElementById('e-g').value, act:val('e-act'), mod:val('e-mod'), 
                customMacros:{p:val('pp'), c:val('pc'), f:val('pf')} 
            };
            await window.DB.setU(u); alert(`${APP_NAME}: Perfil Guardado`); window.S.u=window.DB.norm(u); window.Calc.bio(); window.UI.closeAll();
        } catch (e) { alert("Error: "+e.message); }
    },
    
    // --- BUSCADOR CON EDICIÓN Y BORRADO DE BASE DE DATOS ---
    search: () => {
        const q = document.getElementById('src-in').value.toLowerCase();
        const b = document.getElementById('res-list');
        b.innerHTML = '';
        
        const res = [
            ...window.S.platos.filter(x => x.n.toLowerCase().includes(q)).map(p => ({...p, isPlate: true})), 
            ...window.S.lib.filter(x => x.n.toLowerCase().includes(q))
        ];
        
        res.forEach((f, i) => {
            const icon = f.isPlate ? '<i class="fas fa-utensils" style="color:#9333ea; margin-right:5px"></i> ' : '';
            // BOTONES: Editar (pencil) y Borrar (trash)
            const actions = `
                <div style="display:flex; gap:10px">
                    <button onclick="event.stopPropagation(); window.Logic.openEditLib(${i})" style="border:none; background:none; color:#64748b; cursor:pointer"><i class="fas fa-pencil-alt"></i></button>
                    <button onclick="event.stopPropagation(); window.Logic.delFromDb(${i})" style="border:none; background:none; color:#ef4444; cursor:pointer"><i class="fas fa-trash"></i></button>
                </div>`;
            
            b.innerHTML += `
            <div class="food-suggestion" onclick="window.selectFoundItem(${i})" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee; cursor:pointer">
                <div>${icon}<b>${f.n}</b></div>
                <div style="display:flex; align-items:center; gap:10px">
                    <small style="color:#666">${Math.round(f.k)} kcal</small>
                    ${actions}
                </div>
            </div>`;
        });
        window.S.lastSearch = res;
    },

    // BORRAR DE LA BASE DE DATOS (Plato o Alimento)
    delFromDb: async (idx) => {
        const item = window.S.lastSearch[idx];
        if(!confirm(`¿Borrar "${item.n}" de tu base de datos?`)) return;
        
        if (item.isPlate) {
            window.S.platos = window.S.platos.filter(p => p.n !== item.n);
            await window.DB.savePlates();
        } else {
            window.S.lib = window.S.lib.filter(f => f.n !== item.n);
            await window.DB.saveLib();
        }
        window.Logic.search(); // Refrescar lista
    },

    // ABRIR EDICIÓN DE BASE DE DATOS
    openEditLib: (idx) => {
        const item = window.S.lastSearch[idx];
        window.S.editLibItem = item;
        window.S.editLibIdx = idx; // Guardamos índice si quisiéramos actualizar directamente
        
        if(item.isPlate) {
            // Edición simple de plato (Solo nombre por ahora, editar ingredientes es complejo)
            const newName = prompt("Nuevo nombre del plato:", item.n);
            if(newName && newName !== item.n) {
                // Buscamos el plato original en el array real (no en la búsqueda)
                const realIdx = window.S.platos.findIndex(p => p.n === item.n);
                if(realIdx >= 0) {
                    window.S.platos[realIdx].n = newName;
                    window.DB.savePlates().then(() => {
                        alert("Nombre actualizado");
                        window.Logic.search();
                    });
                }
            }
        } else {
            // Edición completa de alimento
            window.S.editLib = true; // Flag importante
            // Rellenamos el modal con los datos del alimento BASE
            // Asumimos que la cantidad base es 100g para editar macros
            const editData = { ...item, q: item.q || 100 }; 
            window.UI.setQty(editData);
            window.UI.view('v-qty');
            window.UI.open('m-add');
        }
    },

    // GUARDAR EDICIÓN DE LIBRERÍA
    saveLibEdit: async () => {
        const n = document.getElementById('qty-name-in').value;
        const k = parseFloat(document.getElementById('lib-k').value) || 0;
        const p = parseFloat(document.getElementById('lib-p').value) || 0;
        const c = parseFloat(document.getElementById('lib-c').value) || 0;
        const f = parseFloat(document.getElementById('lib-f').value) || 0;
        
        // Encontrar el item original en window.S.lib
        const oldName = window.S.editLibItem.n;
        const libIdx = window.S.lib.findIndex(x => x.n === oldName);
        
        if (libIdx >= 0) {
            window.S.lib[libIdx] = { n, u: 'g', k, p, c, f }; // Actualizamos
            await window.DB.saveLib();
            alert("Alimento base actualizado");
            window.UI.closeAll();
            window.Logic.search();
        } else {
            alert("Error: No se encontró el alimento original");
        }
    },

    savePlateToDb: async () => {
        const n = document.getElementById('plate-name').value;
        if(!n) return alert("Nombre obligatorio");
        const chk = document.querySelectorAll('#plate-ingredients-list input:checked');
        let its = [], tk = 0, tp=0, tc=0, tf=0;
        chk.forEach(c => {
            const i = window.S.day[window.S.srcMeal][c.value]; 
            its.push(i); tk += i.k; tp += i.p; tc += i.c; tf += i.f;
        });
        window.S.platos.push({ n: n, k: tk, p: tp, c: tc, f: tf, items: its });
        await window.DB.savePlates(); 
        document.getElementById('m-create-plate').style.display = 'none'; 
        alert("Plato guardado");
        if(document.getElementById('src-in').value) window.Logic.search();
    },

    // RESTO FUNCIONES
    pdf: () => { window.UI.closeAll(); const d=window.S.d.toLocaleDateString(); let h=`<h1>${APP_NAME} - ${d}</h1><p>Usuario: ${window.S.u.name}</p><hr>`; MEALS.forEach(m=>{const a=window.S.day[m.k]||[]; if(a.length){h+=`<h3>${m.n}</h3><ul>`;a.forEach(i=>h+=`<li>${i.n} (${i.q}${i.u}) - ${Math.round(i.k)}kcal</li>`);h+='</ul>';}}); const el=document.createElement('div');el.innerHTML=h;document.body.appendChild(el);html2pdf().from(el).save(`Reporte_${d}.pdf`);setTimeout(()=>el.remove(),1000); },
    pdfHistory: async () => { const btn=document.querySelector('#m-glob button:nth-child(2)'); btn.innerText="⏳"; try{const s=await fire.getDocs(fire.query(fire.collection(db,`usuarios/${window.S.uid}/diario`))); let h=`<h1>Historial</h1>`; s.forEach(d=>{let dk=0;const da=d.data();MEALS.forEach(m=>{if(da[m.k])da[m.k].forEach(i=>dk+=i.k)});if(dk>0)h+=`<p><b>${d.id}</b>: ${Math.round(dk)} kcal</p>`}); const el=document.createElement('div');el.innerHTML=h;document.body.appendChild(el);html2pdf().from(el).save(`Historial_Completo.pdf`);setTimeout(()=>el.remove(),2000);}catch(e){alert(e);}finally{btn.innerText="📚 PDF Historial";window.UI.closeAll();}},
    exportJSON: async () => { const s=await fire.getDocs(fire.collection(db,`usuarios/${window.S.uid}/diario`)); const d={perfil:window.S.u, historial:{}}; s.forEach(doc=>d.historial[doc.id]=doc.data()); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'})); a.download=`Backup_${window.S.u.name}_${new Date().toISOString().split('T')[0]}.json`; a.click(); },
    importJSON: async (inp) => { const f=inp.files[0]; if(!f)return; inp.value=''; const r=new FileReader(); r.onload=async(e)=>{ try{const d=JSON.parse(e.target.result); const h=d.historial||d.h||d; if(!confirm(`Restaurar ${Object.keys(h).length} días?`))return; const b=fire.writeBatch(db); Object.entries(h).forEach(([k,v])=>{if(k.match(/^\d{4}-\d{2}-\d{2}$/)) b.set(fire.doc(db,`usuarios/${window.S.uid}/diario`,k),v)}); await b.commit(); alert("✅ Importado"); location.reload(); }catch(err){alert("Error JSON");} }; r.readAsText(f); },
    delFromLib: async (n)=>{if(confirm("Borrar?")){window.S.lib=window.S.lib.filter(x=>x.n!==n);await fire.setDoc(window.DB.doc('sistema','biblioteca'),{items:window.S.lib});window.Logic.search();}},
    openAdd: (mk)=>{window.S.tm=mk;window.S.edit=false;window.UI.view('v-home');window.UI.open('m-add');if(window.S.lib.length>0)window.Logic.search();},
    
    saveItem: async ()=>{
        // Si estamos editando un item de librería, usamos la otra función
        if(window.S.editLib) return window.Logic.saveLibEdit();
        
        const q=parseFloat(document.getElementById('qty-in').value), u=document.getElementById('unit-in').value, n=document.getElementById('qty-name-in').value; 
        const b=window.S.item, f=q/100; 
        // Si es un plato, no recalculamos macros base (ya vienen totales), si es ingrediente sí.
        // Pero para simplificar, asumimos que b tiene los macros base por 100g si viene de lib.
        // Si viene de search (plato o lib), b tiene los datos.
        // Para platos guardados, k suele ser total. Para lib, por 100g.
        // Ajuste: si es plato, f debe ser 1 (si no se escala).
        // Simplificación: Guardamos tal cual la lógica de siempre
        const ent={n:n,q:q,u:u,k:b.k*f,p:b.p*f,c:b.c*f,f:b.f*f}; 
        if(window.S.edit)window.S.day[window.S.tm][window.S.eIdx]=ent; else window.S.day[window.S.tm].push(ent); 
        await window.DB.setDay(); window.UI.closeAll(); window.Sys.sync();
    },
    updateCalories: ()=>{const q=parseFloat(document.getElementById('qty-in').value)||0; document.getElementById('calc-kcal').innerText=Math.round(window.S.item.k*(q/100));},
    updateLibCalories: ()=>{ /* Helper visual si se quisiera */ },
    
    editItem: (mk,i)=>{window.S.edit=true;window.S.tm=mk;window.S.eIdx=i;window.S.item=JSON.parse(JSON.stringify(window.S.day[mk][i]));window.S.editLib=false;window.UI.setQty(window.S.item);window.UI.view('v-qty');window.UI.open('m-add');},
    delItem: async (mk,i)=>{if(confirm("Borrar?")){window.S.day[mk].splice(i,1);await window.DB.setDay();window.Sys.sync();}},
    wipeMeal: async (mk)=>{if(confirm("Vaciar?")){window.S.day[mk]=[];await window.DB.setDay();window.Sys.sync();}},
    wipe: async ()=>{if(confirm("Borrar día?")){window.S.day={};await window.DB.setDay();window.Sys.sync();window.UI.closeAll();}},
    openCopy: (mk,t)=>{window.S.srcMeal=mk;window.S.copyMode=t;document.getElementById('copy-date').valueAsDate=window.S.d;document.getElementById('copy-meal').value=mk;window.UI.open('m-copy');},
    execCopy: async ()=>{const d=document.getElementById('copy-date').value, tm=document.getElementById('copy-meal').value; const r=fire.doc(db,`usuarios/${window.S.uid}/diario`,d); const s=await fire.getDoc(r); let da=s.exists()?s.data():{}; if(!da[tm])da[tm]=[]; da[tm]=da[tm].concat(window.S.day[window.S.srcMeal]); await fire.setDoc(r,da); if(window.S.copyMode=='move'){window.S.day[window.S.srcMeal]=[];await window.DB.setDay();} window.UI.closeAll(); if(d===window.S.d.toISOString().split('T')[0]) window.Sys.sync(); alert("Hecho");},
    openCreatePlate: (mk)=>{window.S.srcMeal=mk;const c=document.getElementById('plate-ingredients-list');c.innerHTML='';window.S.day[mk].forEach((it,i)=>{c.innerHTML+=`<div class="plate-check-row"><span>${it.n}</span><input type="checkbox" value="${i}" checked></div>`});document.getElementById('m-create-plate').style.display='flex';},
    openItemAct: (mk,i)=>{window.S.tm=mk;window.S.eIdx=i;window.S.item=window.S.day[mk][i];document.getElementById('ia-name').innerText=window.S.item.n;document.getElementById('ia-date').valueAsDate=window.S.d;document.getElementById('ia-meal').value=mk;window.UI.open('m-item-act');},
    execItemAct: async (mode)=>{const d=document.getElementById('ia-date').value, tm=document.getElementById('ia-meal').value; let td=(d===window.S.d.toISOString().split('T')[0])?window.S.day:(await fire.getDoc(fire.doc(db,`usuarios/${window.S.uid}/diario`,d))).data()||{}; if(!td[tm])td[tm]=[]; td[tm].push(window.S.item); if(mode=='move')window.S.day[window.S.tm].splice(window.S.eIdx,1); await fire.setDoc(fire.doc(db,`usuarios/${window.S.uid}/diario`,d),td); await window.DB.setDay(); window.UI.closeAll(); window.Sys.sync();},
    syncHistory: async () => { const btn=document.querySelector('#m-glob button:nth-child(6)'); btn.innerText="⏳"; try{const s=await fire.getDocs(fire.collection(db,`usuarios/${window.S.uid}/diario`)); let c=0; s.forEach(d=>{Object.values(d.data()).forEach(m=>{if(Array.isArray(m)) m.forEach(i=>{if(!window.S.lib.find(x=>x.n===i.n)){let f=i.q/100||1; window.S.lib.push({n:i.n,u:i.u,q:100,k:i.k/f,p:i.p/f,c:i.c/f,f:i.f/f}); c++;}})})}); if(c>0)await fire.setDoc(window.DB.doc('sistema','biblioteca'),{items:window.S.lib}); alert(`Recuperados ${c}`);}catch(e){alert(e);}finally{btn.innerText="🔄 Sincronizar";} }
};

// --- 8. STATS (ANILLO CORRECTO) ---
window.Stats = {
    chartDaily: null, chartWeekly: null, chartWeight: null, currentDate: new Date(),
    open: () => { window.S.d = new Date(); window.UI.open('m-stats'); setTimeout(window.Stats.updateView, 150); },
    changeDate: (d) => { window.S.d.setDate(window.S.d.getDate()+d); window.Stats.updateView(); },
    load: (d) => { if(d) window.S.d=new Date(d); window.Stats.updateView(); },
    saveWeight: async () => { 
        let val = parseFloat(document.getElementById('w-today').value); if(!val) return alert("Pon un peso");
        const dStr = window.S.d.toISOString().split('T')[0];
        const ref = fire.doc(db, `usuarios/${window.S.uid}/diario`, dStr);
        const snap = await fire.getDoc(ref); let data = snap.exists() ? snap.data() : {}; data.weight = val;
        await fire.setDoc(ref, data); if (dStr === window.S.d.toISOString().split('T')[0]) window.S.day.weight = val;
        alert(`${APP_NAME}: Peso guardado`); window.Stats.updateView();
    },
    updateView: async () => {
        try {
            const dStr = window.S.d.toISOString().split('T')[0]; document.getElementById('st-date').value = dStr;
            const q = await fire.getDocs(fire.query(fire.collection(db, `usuarios/${window.S.uid}/diario`), fire.orderBy('__name__')));
            const hist = []; q.forEach(x=>hist.push({id:x.id, ...x.data()}));
            const cur = hist.find(x=>x.id===dStr); document.getElementById('w-today').value = cur?cur.weight:'';
            
            const fb = document.getElementById('w-feedback'); let html = '';
            let firstW=84.5; let prevW=null, currW=cur?cur.weight:null;
            for(let h of hist){ if(h.weight){ firstW = h.weight; break; } }
            for(let h of hist){ if(h.weight && h.id < dStr) prevW = h.weight; }
            if(currW) {
                const diff = (c, b) => { const d=c-b; const col = d > 0 ? 'text-bad' : 'text-ok'; return `<b class="${col}">${d>0?'+':''}${d.toFixed(1)}kg</b>`; };
                if(prevW) html+=`<span>vs Ant: ${diff(currW,prevW)}</span>`;
                html+=`<span>vs Ini (${firstW}): ${diff(currW, firstW)}</span>`;
            }
            fb.innerHTML = html;

            let dayCal=0; if(cur) MEALS.forEach(m=>{ if(cur[m.k]) cur[m.k].forEach(i=>dayCal+=i.k); });
            const goal = window.S.u.calc.goal;
            const diffCal = goal - dayCal;
            const isOver = diffCal < 0;
            
            // GRÁFICA AZUL/ROJA
            const cData = isOver ? [goal, Math.abs(diffCal)] : [dayCal, diffCal];
            const cBg = isOver ? ['#3b82f6', '#ef4444'] : ['#3b82f6', '#10b981']; // Verde si sobra
            
            const ctxD = document.getElementById('chart-daily');
            if(window.Stats.chartDaily) window.Stats.chartDaily.destroy();
            window.Stats.chartDaily = new Chart(ctxD, { type:'doughnut', data:{labels:['Base','Resto/Exc'],datasets:[{data:cData, backgroundColor:cBg, borderWidth:0}]}, options:{cutout:'75%', plugins:{legend:{display:false}}} });
            
            const diffColor = isOver ? 'text-bad' : 'text-ok';
            document.getElementById('daily-txt').innerHTML=`<span class="srt-val">${Math.round(dayCal)}</span><span class="srt-lbl">de ${goal}</span><br><span class="${diffColor}">${isOver?'+':''}${Math.round(Math.abs(diffCal))}</span>`;

            // SEMANAL
            const dObj = new Date(window.S.d); const dayNum = dObj.getDay()||7; dObj.setDate(dObj.getDate()-dayNum+1);
            let wCal=0, wGoal=goal*7;
            for(let i=0;i<7;i++){ const tD=new Date(dObj); tD.setDate(dObj.getDate()+i); const k=tD.toISOString().split('T')[0]; const h=hist.find(x=>x.id===k); if(h) MEALS.forEach(m=>{if(h[m.k]) h[m.k].forEach(x=>wCal+=x.k)}); }
            if(window.Stats.chartWeekly) window.Stats.chartWeekly.destroy();
            window.Stats.chartWeekly = new Chart(document.getElementById('chart-weekly'), { type:'doughnut', data:{labels:['S','R'],datasets:[{data:[wCal, Math.max(0, wGoal-wCal)], backgroundColor:['#8b5cf6','#e2e8f0']}]}, options:{cutout:'75%', plugins:{legend:{display:false}}} });
            document.getElementById('weekly-txt').innerHTML=`<span class="srt-val">${Math.round(wCal)}</span><span class="srt-lbl">de ${wGoal}</span>`;

            // PESO
            const cD=[], cW=[]; for(let i=29; i>=0; i--) { const tD=new Date(window.S.d); tD.setDate(tD.getDate()-i); const k=tD.toISOString().split('T')[0]; cD.push(k.slice(5)); const h=hist.find(x=>x.id===k); cW.push(h?h.weight:null); }
            if(window.Stats.chartWeight) window.Stats.chartWeight.destroy();
            window.Stats.chartWeight = new Chart(document.getElementById('chart-weight'), { type:'line', data:{labels:cD, datasets:[{label:'Peso', data:cW, borderColor:'#10b981', tension:0.4, spanGaps:true}]}, options:{plugins:{legend:{display:false}}, maintainAspectRatio:false} });
        } catch(e) { console.error("Stats:", e); }
    }
};

// --- 9. AI REPARADA (GEMINI VISION & TEXT) ---
window.AI = {
    saveConfig: () => { localStorage.setItem('t_ai_key', document.getElementById('ai-key').value); window.UI.view('v-home'); window.UI.checkAI(); },
    toggleEye: () => { const x = document.getElementById('ai-key'); x.type = x.type==='password'?'text':'password'; },
    listen: () => { 
        if(!('webkitSpeechRecognition' in window)) return alert("Voz no soportada en este navegador");
        const rec = new webkitSpeechRecognition(); 
        rec.lang='es-ES'; rec.start(); 
        rec.onresult=(e)=>{document.getElementById('ai-text').value += " " + e.results[0][0].transcript;}; 
    },
    
    // PROCESAR TEXTO
    process: async () => { 
        const k=localStorage.getItem('t_ai_key'); if(!k)return window.UI.view('v-conf'); 
        const t=document.getElementById('ai-text').value; 
        if(!t) return alert("Escribe o dicta algo");
        
        const prompt = `Analiza este texto y extrae alimentos. Responde SOLO con un array JSON válido sin markdown: [{"n":"Nombre","q":cantidad_numero,"u":"g/ml/ud","k":kcal_total,"p":prot,"c":carb,"f":grasa}]. Base 100g si no se especifica cantidad. Texto: ${t}`;
        
        try{
            const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${k}`,{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({contents:[{parts:[{text: prompt}]}]})
            }); 
            const d=await r.json(); 
            const txt = d.candidates[0].content.parts[0].text;
            const j=JSON.parse(txt.replace(/```json|```/g, '').trim()); 
            
            j.forEach(i=>{ window.S.day[window.S.tm].push({...i,q:i.q,k:i.k,p:i.p,c:i.c,f:i.f}) }); 
            await window.DB.setDay(); 
            window.UI.closeAll(); 
            window.Sys.sync(); 
        }catch(e){alert("Error AI: " + e.message);} 
    },
    
    // PROCESAR IMAGEN (TABLA NUTRICIONAL)
    processImage: async (file) => {
        const k=localStorage.getItem('t_ai_key'); if(!k)return window.UI.view('v-conf');
        if(!file) return;
        
        // Convertir a Base64
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const base64Data = reader.result.split(',')[1];
            
            const prompt = `Analiza esta imagen de tabla nutricional o comida. Extrae los datos y devuelve SOLO un array JSON válido: [{"n":"Nombre aproximado","q":100,"u":"g","k":kcal_100g,"p":prot_100g,"c":carb_100g,"f":fat_100g}]. Si es comida, estima.`;
            
            try {
                const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${k}`,{
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({
                        contents:[{
                            parts:[
                                {text: prompt},
                                {inline_data: {mime_type: file.type, data: base64Data}}
                            ]
                        }]
                    })
                });
                const d=await r.json();
                const txt = d.candidates[0].content.parts[0].text;
                const j=JSON.parse(txt.replace(/```json|```/g, '').trim());
                
                j.forEach(i=>{ window.S.day[window.S.tm].push({...i,q:i.q,k:i.k,p:i.p,c:i.c,f:i.f}) });
                await window.DB.setDay();
                window.UI.closeAll();
                window.Sys.sync();
            } catch(e) { alert("Error Imagen AI: " + e.message); }
        };
    }
};

window.selectFoundItem = (i) => { const s=window.S.lastSearch[i]; if(s.isPlate){if(confirm("Añadir?")){s.items.forEach(it=>window.S.day[window.S.tm].push(it));window.Logic.autoSave();}} else {window.S.item=s;window.UI.setQty(s);window.UI.view('v-qty');} };
if (document.readyState === 'complete') window.Sys.init(); else window.addEventListener('load', window.Sys.init);