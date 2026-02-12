import { db, fire } from './firebase-config.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth();
const provider = new GoogleAuthProvider();
const APP_NAME = "Nutr-IA";

setTimeout(() => { const s = document.getElementById('loading-screen'); if (s && s.style.display != 'none') s.style.display = 'none'; }, 4000);

const MEALS = [ { k: '01_desayuno', n: 'Desayuno', i: 'fa-coffee' }, { k: '02_almuerzo', n: 'Almuerzo', i: 'fa-bread-slice' }, { k: '03_comida', n: 'Comida', i: 'fa-utensils' }, { k: '04_merienda', n: 'Merienda', i: 'fa-apple-alt' }, { k: '05_cena', n: 'Cena', i: 'fa-moon' } ];

const UNIT_WEIGHT_MAP = {
    'g': 1, 'ml': 1, 'jarra250ml': 250, 'unidad': 100, 'lata': 60, 'porción': 100, 'taza': 240, 'cucharada': 15
};

window.S = { d: new Date(), uid: null, u: null, day: {}, lib: [], favoritos: [], platos: [], allUsers: [], tm: null, item: null, edit: false, eIdx: null, srcMeal: null, copyMode: 'copy', lastSearch: [], plateEditIdx: -1, editLibItem: null, editLib: false, unitConfigs: {}, editingPlate: false, plateMode: 'create' };

window.Sys = {
    init: async () => {
        let tX = 0;
        document.addEventListener('touchstart', e => tX = e.changedTouches[0].screenX);
        document.addEventListener('touchend', e => {
            if (e.changedTouches[0].screenX < tX - 50) window.Logic.day(1);
            if (e.changedTouches[0].screenX > tX + 50) window.Logic.day(-1);
        });

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                ['v-login'].forEach(x=>document.getElementById(x).style.display='none');
                ['app-header','feed','fab-btn'].forEach(x=>document.getElementById(x).style.display='block');
                document.getElementById('fab-btn').style.display='flex';
                
                let dbId = user.uid; 
                try {
                    const q = fire.query(fire.collection(db, 'usuarios'), fire.where('uid', '==', user.uid));
                    const querySnapshot = await fire.getDocs(q);
                    if (!querySnapshot.empty) {
                        dbId = querySnapshot.docs[0].id;
                    } else {
                        const nameRef = fire.doc(db, 'usuarios', user.displayName || "");
                        const nameSnap = await fire.getDoc(nameRef);
                        if (nameSnap.exists() && !nameSnap.data().uid) {
                            await fire.updateDoc(nameRef, { uid: user.uid });
                            dbId = nameSnap.id;
                        }
                    }
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
            await window.DB.loadFavoritos();
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

window.DB = {
    col: (n) => fire.collection(db, n),
    doc: (p, i) => fire.doc(db, p, i),
    norm: (u) => ({ id: u.name||u.uid, name: u.name||'Usuario', email: u.email, h: parseFloat(u.h||170), w: parseFloat(u.w||70), y: parseInt(u.y||1990), g: u.g||'male', act: u.act||"1.2", mod: u.mod||"0", mac: u.customMacros || {p:null, c:null, f:null} }),
    setU: async (u) => { await fire.setDoc(fire.doc(db, 'usuarios', u.name), u); window.S.uid = u.name; },
    getU: async (id) => { const s = await fire.getDoc(fire.doc(db, 'usuarios', id)); return s.exists() ? s.data() : null; },
    getDay: async (d) => { if(!window.S.uid) return {}; const k = d.toISOString().split('T')[0]; const s = await fire.getDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, k)); let data = s.exists() ? s.data() : {}; MEALS.forEach(m => { if (!data[m.k]) data[m.k] = [] }); return data; },
    setDay: async () => { if(!window.S.uid) return; const k = window.S.d.toISOString().split('T')[0]; await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, k), window.S.day); },
    lib: async () => { const s = await fire.getDoc(window.DB.doc('sistema', 'biblioteca')); window.S.lib = s.exists() ? s.data().items : []; },
    saveLib: async () => { await fire.setDoc(window.DB.doc('sistema', 'biblioteca'), { items: window.S.lib }); },
    loadFavoritos: async () => { if(!window.S.uid) return; try { const s = await fire.getDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/favoritos`)); window.S.favoritos = s.exists() ? s.data().items : []; } catch (e) { window.S.favoritos = []; } },
    saveFavoritos: async () => { if(!window.S.uid) return; await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/favoritos`), { items: window.S.favoritos }); },
    getPlates: async () => { try { if(!window.S.uid) return; const s = await fire.getDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/platos`)); window.S.platos = s.exists() ? s.data().items : []; } catch (e) { window.S.platos = []; } },
    savePlates: async () => { if(!window.S.uid) return; await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/platos`), { items: window.S.platos }); }
};

window.UI = {
    open: (id) => { const el = document.getElementById(id); if(el) el.style.display='flex'; },
    closeAll: () => { 
        document.querySelectorAll('.modal').forEach(m=>m.style.display='none');
        window.S.edit = false; window.S.editLib = false; window.S.editingPlate = false;
    },
    view: (id) => { 
        ['v-home','v-conf','v-qty','v-json','v-import'].forEach(x=>{
            const el = document.getElementById(x); if(el) el.style.display='none';
        });
        const target = document.getElementById(id); if(target) target.style.display='block';
    },
    checkAI: () => { if(localStorage.getItem('t_ai_key')) document.getElementById('btn-config-ai').classList.add('configured'); },
    
    setQty: (i) => { 
        try {
            const elN = document.getElementById('qty-name-in');
            const elQ = document.getElementById('qty-in');
            const elU = document.getElementById('unit-in');
            
            if(elN) elN.value = i.n || "";
            if(elQ) elQ.value = i.q || 100;
            if(elU) elU.value = i.u || "g"; 
            
            const libSection = document.getElementById('lib-edit-section');
            
            if(window.S.editLib && !i.isPlate) {
                if(libSection) {
                    libSection.style.display='block';
                    document.getElementById('calc-kcal').value = i.k || 0;
                    document.getElementById('calc-p').value = i.p || 0;
                    document.getElementById('calc-c').value = i.c || 0;
                    document.getElementById('calc-f').value = i.f || 0;
                }
            } else {
                if(libSection) libSection.style.display='none';
                window.Logic.updateUnitDisplay();
                window.Logic.updateCalories();
            }
        } catch(e) { console.error("UI Error:", e); }
    },

    openProfile: () => {
        if(!window.S.u) return; const u=window.S.u;
        document.getElementById('e-name').value=u.name; document.getElementById('e-h').value=u.h; document.getElementById('e-w').value=u.w;
        document.getElementById('e-y').value=u.y; document.getElementById('e-g').value=u.g; document.getElementById('e-act').value=u.act; document.getElementById('e-mod').value=u.mod;
        document.getElementById('pp').value=u.mac.p; document.getElementById('pc').value=u.mac.c; document.getElementById('pf').value=u.mac.f;
        window.Calc.live(); window.UI.open('m-prof');
    },
    newProfile: () => { window.S.u=null; document.querySelectorAll('#m-prof input').forEach(i=>i.value=''); window.UI.open('m-prof'); }
};

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

window.Render = {
    all: () => {
        document.getElementById('h-day').innerText = window.S.d.toLocaleDateString('es-ES', {weekday:'long'});
        document.getElementById('h-full').innerText = window.S.d.toLocaleDateString('es-ES');
        if(window.S.u) document.getElementById('h-av').innerText = window.S.u.name.charAt(0).toUpperCase();
        let t={k:0, p:0, c:0, f:0}; Object.values(window.S.day).forEach(arr=>{if(Array.isArray(arr))arr.forEach(i=>{t.k+=i.k;t.p+=i.p;t.c+=i.c;t.f+=i.f;});});
        
        if(!window.S.u||!window.S.u.calc)return;
        
        const tg = window.S.u.calc; 
        const diff = tg.goal - t.k;
        const maintenance = tg.maintenance || tg.goal;
        
        const bioHtml = `<div class="top-stat-bar" style="display:flex; justify-content:center; gap:20px; font-weight:700; font-size:0.9rem; margin-bottom:10px;"><div style="color:#f59e0b; display:flex; align-items:center; gap:5px"><i class="fas fa-fire"></i> Mant: ${maintenance}</div><div style="color:#ef4444; display:flex; align-items:center; gap:5px"><i class="fas fa-bullseye"></i> Meta: ${tg.goal}</div></div>`;
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
                        <button style="width:32px; height:32px; border:1px solid #e2e8f0; background:white; border-radius:8px; color:#f59e0b; cursor:pointer;" onclick="window.Logic.openItemAct('${m.k}',${idx})" title="Mover/Copiar">⇄</button>
                        <button style="width:32px; height:32px; border:1px solid #e2e8f0; background:white; border-radius:8px; color:#64748b; cursor:pointer;" onclick="window.Logic.editItem('${m.k}',${idx})" title="Editar">✏️</button>
                        <button style="width:32px; height:32px; border:1px solid #fee2e2; background:white; border-radius:8px; color:#ef4444; cursor:pointer;" onclick="window.Logic.delItem('${m.k}',${idx})" title="Borrar">🗑️</button>
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
                            <button style="${sAdd}" onclick="window.Logic.openAdd('${m.k}')" title="Agregar"><i class="fas fa-plus"></i></button>
                        </div>
                    </div>
                </div>`;
            feed.innerHTML += `<div class="card" style="background:white; border-radius:16px; margin-bottom:20px; box-shadow:0 4px 15px rgba(0,0,0,0.05); overflow:hidden; border:1px solid #e2e8f0;">${mealHeader}<div>${rows}</div></div>`;
        });
    }
};

window.Logic = {
    day: (n) => { window.S.d.setDate(window.S.d.getDate() + n); window.Sys.sync(); },
    autoSave: async () => { await window.DB.setDay(); window.Render.all(); },
    
    saveUser: async () => {
        const n = document.getElementById('e-name').value; 
        if (!n) return alert("Nombre obligatorio");
        try {
            const realUid = auth.currentUser ? auth.currentUser.uid : window.S.uid;
            const val = (id) => parseFloat(document.getElementById(id).value);
            const u = { 
                uid: realUid, 
                name: n, 
                email: auth.currentUser ? auth.currentUser.email : "", 
                h: val('e-h'), w: val('e-w'), y: val('e-y'), 
                g: document.getElementById('e-g').value, 
                act: val('e-act'), mod: val('e-mod'), 
                customMacros: { p: val('pp'), c: val('pc'), f: val('pf') } 
            };
            await fire.setDoc(fire.doc(db, 'usuarios', n), u); 
            alert("¡Perfil vinculado con éxito!");
            window.S.u = window.DB.norm(u);
            window.S.uid = n; 
            window.Calc.bio();
            window.UI.closeAll();
            if (window.S.u) document.getElementById('h-av').innerText = window.S.u.name.charAt(0).toUpperCase();
            location.reload();
        } catch (e) { alert("Error: " + e.message); }
    },
    
    openAdd: (mk) => { window.S.tm = mk; window.S.edit = false; window.S.editLib = false; window.UI.view('v-home'); window.UI.open('m-add'); if(window.S.lib.length > 0 || window.S.favoritos.length > 0) window.Logic.search(); },

    search: () => {
        const q = document.getElementById('src-in').value.toLowerCase();
        const b = document.getElementById('res-list'); b.innerHTML = '';
        const favoritos = window.S.favoritos.map(f => ({...f, isFavorito: true}));
        const platos = window.S.platos.filter(x => x.n.toLowerCase().includes(q)).map(p => ({...p, isPlate: true}));
        const biblioteca = window.S.lib.filter(x => x.n.toLowerCase().includes(q));
        const res = [...favoritos.filter(x => x.n.toLowerCase().includes(q)), ...platos, ...biblioteca];
        
        res.forEach((f, i) => {
            const icon = f.isFavorito ? '⭐' : f.isPlate ? '🍽️' : '';
            b.innerHTML += `<div class="food-suggestion" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee"><div onclick="window.selectFoundItem(${i})" style="flex:1; cursor:pointer"><b>${icon}${f.n}</b> <small>${Math.round(f.k)} kcal</small></div><div style="display:flex; gap:10px"><button onclick="event.stopPropagation(); window.Logic.openEditLib(${i})" style="border:none; background:none; cursor:pointer; color:#64748b; font-size:1.1rem" title="Editar">✏️</button><button onclick="event.stopPropagation(); window.Logic.delFromDb(${i})" style="border:none; background:none; cursor:pointer; color:#ef4444; font-size:1.1rem" title="Borrar">🗑️</button></div></div>`;
        });
        window.S.lastSearch = res;
    },

    delFromDb: async (i) => {
        const item = window.S.lastSearch[i]; if(!confirm(`¿Borrar ${item.n}?`)) return;
        if(item.isFavorito) { 
            window.S.favoritos = window.S.favoritos.filter(p => p.n !== item.n); 
            await window.DB.saveFavoritos(); 
        } else if(item.isPlate) { 
            window.S.platos = window.S.platos.filter(p => p.n !== item.n); 
            await window.DB.savePlates(); 
        } else { 
            window.S.lib = window.S.lib.filter(l => l.n !== item.n); 
            await window.DB.saveLib(); 
        }
        window.Logic.search();
    },

    openEditLib: (i) => {
        const item = window.S.lastSearch[i];
        if(item.isFavorito || item.isPlate) {
            window.S.editingPlate = true;
            window.S.plateMode = 'edit';
            window.S.plateEditIdx = item.isFavorito ? 
                window.S.favoritos.findIndex(p => p.n === item.n) :
                window.S.platos.findIndex(p => p.n === item.n);
            window.Logic.openEditPlate();
        } else {
            window.S.editLib = true; 
            window.S.editLibItem = item; 
            window.S.item = {...item};
            window.UI.setQty({...item, q:100, u:'g'}); 
            window.UI.view('v-qty'); 
            window.UI.open('m-add');
        }
    },

    saveLibEdit: async () => {
        const n = document.getElementById('qty-name-in').value;
        const k = parseFloat(document.getElementById('calc-kcal').value);
        const p = parseFloat(document.getElementById('calc-p').value);
        const c = parseFloat(document.getElementById('calc-c').value);
        const f = parseFloat(document.getElementById('calc-f').value);
        const baseWeight = parseFloat(document.getElementById('unit-weight').value) || 100;
        
        const idx = window.S.lib.findIndex(x=>x.n===window.S.editLibItem.n); 
        if(idx >= 0) {
            const item = {n, k, p, c, f, u:'g', baseWeight: baseWeight};
            window.S.lib[idx] = item;
            window.S.unitConfigs[n] = { weight: baseWeight };
            await window.DB.saveLib();
        }
        window.UI.closeAll(); 
        window.Logic.search();
    },

    isSimilar: (name1, name2) => {
        const s1 = name1.toLowerCase().trim();
        const s2 = name2.toLowerCase().trim();
        if (s1.includes(s2) || s2.includes(s1)) return true;
        const words1 = s1.split(' ');
        const words2 = s2.split(' ');
        const matches = words1.filter(w => words2.includes(w)).length;
        return matches > 0;
    },

    isMacroSimilar: (item1, item2, tolerance = 5) => {
        const diffK = Math.abs(item1.k - item2.k) / Math.max(item1.k, item2.k) * 100;
        const diffP = Math.abs(item1.p - item2.p) / Math.max(item1.p, item2.p) * 100;
        const diffC = Math.abs(item1.c - item2.c) / Math.max(item1.c, item2.c) * 100;
        const diffF = Math.abs(item1.f - item2.f) / Math.max(item1.f, item2.f) * 100;
        return diffK <= tolerance && diffP <= tolerance && diffC <= tolerance && diffF <= tolerance;
    },

    checkDuplicates: (newItem) => {
        const similares = [];
        window.S.favoritos.forEach(fav => {
            if (window.Logic.isSimilar(newItem.n, fav.n) && window.Logic.isMacroSimilar(newItem, fav)) {
                similares.push(fav);
            }
        });
        return similares;
    },

    saveFavorito: async () => {
        const n = document.getElementById('qty-name-in').value;
        const k = parseFloat(document.getElementById('calc-kcal').value);
        const p = parseFloat(document.getElementById('calc-p').value);
        const c = parseFloat(document.getElementById('calc-c').value);
        const f = parseFloat(document.getElementById('calc-f').value);
        
        const newItem = {n, k, p, c, f, u:'g', isFavorito: true};
        const similares = window.Logic.checkDuplicates(newItem);
        
        if(similares.length > 0) {
            const existente = similares[0];
            const msg = `⚠️ YA EXISTE UN FAVORITO PARECIDO:\n\n"${existente.n}"\n${Math.round(existente.k)} kcal\n\n¿Deseas ACTUALIZAR o CREAR NUEVO?`;
            
            if(confirm(msg)) {
                const idx = window.S.favoritos.findIndex(x => x.n === existente.n);
                window.S.favoritos[idx] = newItem;
                await window.DB.saveFavoritos();
                alert("✅ Favorito ACTUALIZADO");
            } else {
                window.S.favoritos.push(newItem);
                await window.DB.saveFavoritos();
                alert("✅ NUEVO Favorito guardado");
            }
        } else {
            window.S.favoritos.push(newItem);
            await window.DB.saveFavoritos();
            alert("✅ Alimento guardado como FAVORITO");
        }
        window.UI.closeAll();
        window.Logic.search();
    },

    saveItem: async () => {
        if(window.S.editLib) return window.Logic.saveLibEdit();
        
        const n = document.getElementById('qty-name-in').value;
        const q = parseFloat(document.getElementById('qty-in').value);
        const u = document.getElementById('unit-in').value;
        
        const baseWeight = (u!=='g' && u!=='ml') ? parseFloat(document.getElementById('unit-weight').value) : 100;
        const k = parseFloat(document.getElementById('calc-kcal').value)||0;
        const p = parseFloat(document.getElementById('calc-p').value)||0;
        const c = parseFloat(document.getElementById('calc-c').value)||0;
        const f = parseFloat(document.getElementById('calc-f').value)||0;

        const ent = {n, q, u, k, p, c, f, baseWeight: baseWeight};
        
        if(window.S.edit) window.S.day[window.S.tm][window.S.eIdx]=ent; 
        else window.S.day[window.S.tm].push(ent);
        
        await window.DB.setDay(); 
        window.UI.closeAll(); 
        window.Sys.sync();
    },

    updateCalories: () => { 
        if(!window.S.item) return;
        const q = parseFloat(document.getElementById('qty-in').value) || 0;
        const u = document.getElementById('unit-in').value;
        
        let w = UNIT_WEIGHT_MAP[u] || 100;
        const totalGrams = q * w;
        
        const calc = (val100) => Math.round(((val100||0) * totalGrams) / 100);

        document.getElementById('calc-kcal').value = calc(window.S.item.k);
        document.getElementById('calc-p').value = calc(window.S.item.p);
        document.getElementById('calc-c').value = calc(window.S.item.c);
        document.getElementById('calc-f').value = calc(window.S.item.f);
    },

    updateBase: () => {
        const q = parseFloat(document.getElementById('qty-in').value) || 0;
        const u = document.getElementById('unit-in').value;
        let w = UNIT_WEIGHT_MAP[u] || 100;
        
        const totalGrams = q * w;
        if(totalGrams <= 0) return;

        const toBase = (val) => (parseFloat(val)||0) * 100 / totalGrams;

        window.S.item.k = toBase(document.getElementById('calc-kcal').value);
        window.S.item.p = toBase(document.getElementById('calc-p').value);
        window.S.item.c = toBase(document.getElementById('calc-c').value);
        window.S.item.f = toBase(document.getElementById('calc-f').value);
    },

    updateUnitDisplay: () => {
        const u = document.getElementById('unit-in').value;
        const section = document.getElementById('unit-config-section');
        const isStd = (u === 'g' || u === 'ml');
        
        section.style.display = isStd ? 'none' : 'block';
        if(!isStd) {
            const currentW = window.S.item.baseWeight || UNIT_WEIGHT_MAP[u] || 100;
            if(!document.getElementById('unit-weight').value || window.S.item.u !== u) {
                document.getElementById('unit-weight').value = currentW;
            }
        }
        window.Logic.updateCalories();
    },

    saveUnitConfig: () => {
        const n = document.getElementById('qty-name-in').value;
        const u = document.getElementById('unit-in').value;
        const w = parseFloat(document.getElementById('unit-weight').value);
        if(n && u && w) {
            window.S.unitConfigs = window.S.unitConfigs || {};
            window.S.unitConfigs[`${n}_${u}`] = w;
            window.S.item.baseWeight = w;
            alert(`✅ Configurado: 1 ${u} = ${w}g`);
            window.Logic.updateCalories();
        }
    },

    editItem: (mk,i) => { 
        window.S.edit = true; 
        window.S.tm = mk; 
        window.S.eIdx = i; 
        const orig = window.S.day[mk][i];
        
        // CORRECCIÓN CRÍTICA: Usar los valores tal cual están guardados
        window.S.item = {...orig};
        
        window.S.editLib = false; 
        window.UI.setQty(orig); 
        window.Logic.updateUnitDisplay(); 
        window.Logic.updateCalories();    
        
        window.UI.view('v-qty'); 
        window.UI.open('m-add'); 
    },

    delItem: async (mk,i) => { if(confirm("¿Borrar este alimento?")){window.S.day[mk].splice(i,1); await window.DB.setDay(); window.Sys.sync();}},
    wipeMeal: async (mk) => { if(confirm("¿Vaciar esta comida?")){window.S.day[mk]=[]; await window.DB.setDay(); window.Sys.sync();}},
    openCopy: (mk,t) => { window.S.srcMeal=mk; window.S.copyMode=t; document.getElementById('copy-date').valueAsDate=window.S.d; document.getElementById('copy-meal').value=mk; window.UI.open('m-copy'); },
    execCopy: async () => { const d=document.getElementById('copy-date').value, tm=document.getElementById('copy-meal').value, r=fire.doc(db,`usuarios/${window.S.uid}/diario`,d), s=await fire.getDoc(r); let da=s.exists()?s.data():{}; if(!da[tm])da[tm]=[]; da[tm]=da[tm].concat(window.S.day[window.S.srcMeal]); await fire.setDoc(r,da); if(window.S.copyMode=='move'){window.S.day[window.S.srcMeal]=[]; await window.DB.setDay();} window.UI.closeAll(); if(d===window.S.d.toISOString().split('T')[0]) window.Sys.sync(); },
    openCreatePlate: (mk) => { window.S.srcMeal=mk; window.S.plateMode='create'; const c=document.getElementById('plate-ingredients-list'); c.innerHTML=''; window.S.day[mk].forEach((it,i)=>{c.innerHTML+=`<div class="plate-check-row"><span>${it.n}</span><input type="checkbox" value="${i}" checked></div>`}); window.UI.open('m-create-plate'); },
    savePlateToDb: async () => { const n=document.getElementById('plate-name').value; if(!n) return alert("Nombre del plato requerido"); const chk=document.querySelectorAll('#plate-ingredients-list input:checked'); let its=[],tk=0,tp=0,tc=0,tf=0; chk.forEach(c=>{const i=window.S.day[window.S.srcMeal][c.value]; its.push(i); tk+=i.k; tp+=i.p; tc+=i.c; tf+=i.f;}); window.S.platos.push({n, k:tk, p:tp, c:tc, f:tf, items:its}); await window.DB.savePlates(); window.UI.closeAll(); alert("✅ Plato guardado"); window.Logic.search(); },
    
    openEditPlate: () => {
        const platos = window.S.platos;
        const plate = platos[window.S.plateEditIdx];
        document.getElementById('plate-edit-name').value = plate.n;
        const list = document.getElementById('plate-edit-ingredients-list');
        list.innerHTML = '';
        plate.items.forEach((it, i) => {
            list.innerHTML += `<div class="plate-ingredient-item" style="padding:8px; background:#f1f5f9; border-radius:8px; margin-bottom:5px; display:flex; justify-content:space-between; align-items:center;">
                <span>${it.n} (${it.q}${it.u})</span>
                <button onclick="window.Logic.removeIngredient(${i})" style="border:none; background:none; color:#ef4444; cursor:pointer;">✕</button>
            </div>`;
        });
        window.UI.open('m-edit-plate');
    },

    removeIngredient: (i) => {
        window.S.platos[window.S.plateEditIdx].items.splice(i, 1);
        window.Logic.openEditPlate();
    },

    saveEditPlate: async () => {
        const newName = document.getElementById('plate-edit-name').value;
        if(!newName) return alert("Nombre requerido");
        const plate = window.S.platos[window.S.plateEditIdx];
        plate.n = newName;
        let tk=0, tp=0, tc=0, tf=0;
        plate.items.forEach(i => { tk+=i.k; tp+=i.p; tc+=i.c; tf+=i.f; });
        plate.k = tk; plate.p = tp; plate.c = tc; plate.f = tf;
        await window.DB.savePlates();
        window.UI.closeAll();
        window.Logic.search();
        alert("✅ Plato actualizado");
    },

    openItemAct: (mk,i) => { window.S.tm=mk; window.S.eIdx=i; window.S.item=window.S.day[mk][i]; document.getElementById('ia-name').innerText=window.S.item.n; document.getElementById('ia-date').valueAsDate=window.S.d; document.getElementById('ia-meal').value=mk; window.UI.open('m-item-act'); },
    execItemAct: async (m) => { const d=document.getElementById('ia-date').value, tm=document.getElementById('ia-meal').value; let td=(d===window.S.d.toISOString().split('T')[0])?window.S.day:(await fire.getDoc(fire.doc(db,`usuarios/${window.S.uid}/diario`,d))).data()||{}; if(!td[tm])td[tm]=[]; td[tm].push(window.S.item); if(m=='move')window.S.day[window.S.tm].splice(window.S.eIdx,1); await fire.setDoc(fire.doc(db,`usuarios/${window.S.uid}/diario`,d),td); await window.DB.setDay(); window.UI.closeAll(); window.Sys.sync(); },

    pdf: () => {
        const el = document.getElementById('feed');
        if(!el || el.innerText.trim() === "") return alert("No hay comidas hoy para generar PDF");
        const opt = { margin: 10, filename: `Diario_${window.S.d.toISOString().split('T')[0]}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
        html2pdf().set(opt).from(el).save();
    },

    pdfHistory: async () => {
        if(!confirm("Esto generará un PDF con el resumen de todo tu historial. ¿Continuar?")) return;
        document.getElementById('loading-screen').style.display='flex';
        try {
            const q = await fire.getDocs(fire.query(fire.collection(db, `usuarios/${window.S.uid}/diario`), fire.orderBy('__name__')));
            let html = `<div style="padding:20px; font-family:sans-serif;"><h1 style="color:#0f172a; text-align:center;">Historial Nutricional - ${window.S.u.name}</h1><table style="width:100%; border-collapse:collapse; margin-top:20px; font-size:12px;"><tr style="background:#0f172a; color:white;"><th style="padding:8px;">Fecha</th><th style="padding:8px;">Kcal</th><th style="padding:8px;">Prot</th><th style="padding:8px;">Carb</th><th style="padding:8px;">Grasa</th><th style="padding:8px;">Peso</th></tr>`;
            q.forEach(doc => {
                const d = doc.data(); const date = doc.id;
                let tk=0, tp=0, tc=0, tf=0;
                MEALS.forEach(m => { if(d[m.k]) d[m.k].forEach(i => { tk+=i.k; tp+=i.p; tc+=i.c; tf+=i.f; }); });
                if(tk > 0) {
                    html += `<tr style="border-bottom:1px solid #e2e8f0; text-align:center;"><td style="padding:8px; font-weight:bold;">${date}</td><td style="padding:8px;">${Math.round(tk)}</td><td style="padding:8px; color:#7c3aed;">${Math.round(tp)}</td><td style="padding:8px; color:#0284c7;">${Math.round(tc)}</td><td style="padding:8px; color:#ea580c;">${Math.round(tf)}</td><td style="padding:8px;">${d.weight || '-'}</td></tr>`;
                }
            });
            html += `</table></div>`;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            document.body.appendChild(tempDiv);
            const opt = { margin: 10, filename: `Historial_Completo_${window.S.u.name}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
            await html2pdf().set(opt).from(tempDiv).save();
            document.body.removeChild(tempDiv);
        } catch(e) { alert("Error al generar PDF: " + e.message); }
        document.getElementById('loading-screen').style.display='none';
    },

    exportJSON: async () => {
        document.getElementById('loading-screen').style.display='flex';
        try {
            const q = await fire.getDocs(fire.collection(db, `usuarios/${window.S.uid}/diario`));
            let history = {};
            q.forEach(doc => { history[doc.id] = doc.data(); });
            const backup = { user: window.S.u, history: history, exportedAt: new Date().toISOString() };
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup));
            const anchor = document.createElement('a');
            anchor.setAttribute("href", dataStr);
            anchor.setAttribute("download", `Backup_${window.S.u.name}_${new Date().toISOString().split('T')[0]}.json`);
            document.body.appendChild(anchor); anchor.click(); anchor.remove();
        } catch(e) { alert("Error exportando: " + e.message); }
        document.getElementById('loading-screen').style.display='none';
    },

    importJSON: (input) => {
        const file = input.files[0]; if(!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const json = JSON.parse(e.target.result);
                document.getElementById('loading-screen').style.display='flex';
                if(json.history) {
                    if(!confirm("Esto es un Backup Completo. ¿Quieres restaurar todo el historial?")) {
                        document.getElementById('loading-screen').style.display='none'; return;
                    }
                    const batch = fire.writeBatch(db);
                    Object.entries(json.history).forEach(([date, dayData]) => {
                        const ref = fire.doc(db, `usuarios/${window.S.uid}/diario`, date);
                        batch.set(ref, dayData);
                    });
                    await batch.commit();
                    alert("¡Historial restaurado!");
                    window.Sys.sync();
                } else {
                    const date = new Date().toISOString().split('T')[0];
                    await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, date), json);
                    alert("Día importado para hoy!");
                    window.Sys.sync();
                }
            } catch(e) { alert("Error importando: " + e.message); }
            document.getElementById('loading-screen').style.display='none';
        };
        reader.readAsText(file);
    },

    wipe: async () => {
        if(!confirm("¿Borrar TODOS los datos de hoy?")) return;
        document.getElementById('loading-screen').style.display='flex';
        try {
            const dStr = window.S.d.toISOString().split('T')[0];
            await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, dStr), {});
            window.Sys.sync();
            window.UI.closeAll();
            alert("Día borrado");
        } catch(e) { alert("Error: " + e.message); }
        document.getElementById('loading-screen').style.display='none';
    },

    parse: () => {
        try {
            const json = JSON.parse(document.getElementById('json-in').value);
            if(!Array.isArray(json)) return alert("Debe ser un array JSON");
            json.forEach(item => window.S.day[window.S.tm].push(item));
            window.Logic.autoSave(); window.UI.closeAll();
        } catch(e) { alert("JSON inválido: " + e.message); }
    },
    execImport: async () => {
        const date = document.getElementById('imp-date').value, meal = document.getElementById('imp-meal').value;
        const ref = fire.doc(db, `usuarios/${window.S.uid}/diario`, date), snap = await fire.getDoc(ref);
        if(!snap.exists()) return alert("Sin datos ese día");
        const data = snap.data(); if(!data[meal]) return alert("Sin esa comida");
        window.S.day[meal] = [...(window.S.day[meal] || []), ...data[meal]];
        await window.DB.setDay(); window.UI.closeAll(); window.Render.all();
    }
};

window.Stats = {
    open: () => { document.getElementById('st-date').valueAsDate = window.S.d; window.Stats.updateView(); window.UI.open('m-stats'); },
    changeDate: (n) => { const d = new Date(document.getElementById('st-date').value); d.setDate(d.getDate() + n); document.getElementById('st-date').valueAsDate = d; window.Stats.load(d.toISOString().split('T')[0]); },
    load: async (dStr) => { const ref = fire.doc(db, `usuarios/${window.S.uid}/diario`, dStr); const snap = await fire.getDoc(ref); document.getElementById('w-today').value = snap.exists() && snap.data().weight ? snap.data().weight : ''; },
    saveWeight: async () => {
        const val = parseFloat(document.getElementById('w-today').value);
        if(!val || val <= 0) return alert("Peso no válido");
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
            
            const cData = isOver ? [goal, Math.abs(diffCal)] : [dayCal, diffCal];
            const cBg = isOver ? ['#3b82f6', '#ef4444'] : ['#3b82f6', '#10b981']; 
            
            const ctxD = document.getElementById('chart-daily');
            if(window.Stats.chartDaily) window.Stats.chartDaily.destroy();
            window.Stats.chartDaily = new Chart(ctxD, { type:'doughnut', data:{labels:['Base','Resto/Exc'],datasets:[{data:cData, backgroundColor:cBg, borderWidth:0}]}, options:{cutout:'75%', plugins:{legend:{display:false}}} });
            
            const diffColor = isOver ? 'text-bad' : 'text-ok';
            document.getElementById('daily-txt').innerHTML=`<span class="srt-val">${Math.round(dayCal)}</span><span class="srt-lbl">de ${goal}</span><br><span class="${diffColor}">${isOver?'+':''}${Math.round(Math.abs(diffCal))}</span>`;

            const dObj = new Date(window.S.d); const dayNum = dObj.getDay()||7; dObj.setDate(dObj.getDate()-dayNum+1);
            let wCal=0, wGoal=goal*7;
            for(let i=0;i<7;i++){ const tD=new Date(dObj); tD.setDate(dObj.getDate()+i); const k=tD.toISOString().split('T')[0]; const h=hist.find(x=>x.id===k); if(h) MEALS.forEach(m=>{if(h[m.k]) h[m.k].forEach(x=>wCal+=x.k)}); }
            if(window.Stats.chartWeekly) window.Stats.chartWeekly.destroy();
            window.Stats.chartWeekly = new Chart(document.getElementById('chart-weekly'), { type:'doughnut', data:{labels:['S','R'],datasets:[{data:[wCal, Math.max(0, wGoal-wCal)], backgroundColor:['#8b5cf6','#e2e8f0']}]}, options:{cutout:'75%', plugins:{legend:{display:false}}} });
            document.getElementById('weekly-txt').innerHTML=`<span class="srt-val">${Math.round(wCal)}</span><span class="srt-lbl">de ${wGoal}</span>`;

            const cD=[], cW=[]; for(let i=29; i>=0; i--) { const tD=new Date(window.S.d); tD.setDate(tD.getDate()-i); const k=tD.toISOString().split('T')[0]; cD.push(k.slice(5)); const h=hist.find(x=>x.id===k); cW.push(h?h.weight:null); }
            if(window.Stats.chartWeight) window.Stats.chartWeight.destroy();
            window.Stats.chartWeight = new Chart(document.getElementById('chart-weight'), { type:'line', data:{labels:cD, datasets:[{label:'Peso', data:cW, borderColor:'#10b981', tension:0.4, spanGaps:true}]}, options:{plugins:{legend:{display:false}}, maintainAspectRatio:false} });
        } catch(e) { console.error("Stats:", e); }
    }
};

window.AI = {
    saveConfig: () => { localStorage.setItem('t_ai_key', document.getElementById('ai-key').value); window.UI.view('v-home'); window.UI.checkAI(); },
    listen: () => { 
        const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
        if(!Speech) return alert("Voz no soportada");
        const rec = new Speech(); rec.lang='es-ES'; rec.start(); 
        rec.onresult=(e)=>document.getElementById('ai-text').value+=e.results[0][0].transcript; 
    },
    cleanAndParse: (txt) => {
        let clean = txt.replace(/```json/g, '').replace(/```/g, '');
        const first = clean.indexOf('['); const last = clean.lastIndexOf(']');
        if (first === -1 || last === -1) throw new Error("IA no devolvió una lista válida.");
        clean = clean.substring(first, last + 1);
        return JSON.parse(clean);
    },
    process: async () => {
        const k = localStorage.getItem('t_ai_key'), t = document.getElementById('ai-text').value; if(!k) return window.UI.view('v-conf');
        document.getElementById('loading-screen').style.display='flex';
        try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${k}`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ contents: [{ parts: [{ text: `Analiza: "${t}". Extrae alimentos y devuelve SOLO un array JSON válido: [{"n":"Nombre","q":100,"u":"g","k":kcal_total,"p":pro,"c":carb,"f":fat}]` }] }] })
            });
            const d = await r.json(); 
            if(!d.candidates) throw new Error("Error API: " + JSON.stringify(d));
            const items = window.AI.cleanAndParse(d.candidates[0].content.parts[0].text);
            items.forEach(i => window.S.day[window.S.tm].push(i));
            await window.DB.setDay(); window.UI.closeAll(); window.Sys.sync();
        } catch(e) { alert("Error IA: " + e.message); }
        document.getElementById('loading-screen').style.display='none';
    },
    processImage: async (file) => {
        const k = localStorage.getItem('t_ai_key'); if(!k) return window.UI.view('v-conf');
        document.getElementById('loading-screen').style.display='flex';
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = async () => {
            const base64 = reader.result.split(',')[1];
            try {
                const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${k}`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ contents: [{ parts: [{ text: "Analiza la imagen. Devuelve SOLO un array JSON con los macros aproximados por 100g: [{'n':'Nombre','q':100,'u':'g','k':kcal,'p':pro,'c':carb,'f':fat}]" }, { inline_data: { mime_type: file.type, data: base64 } }] }] })
                });
                const d = await r.json();
                if(!d.candidates) throw new Error("Error al leer imagen.");
                const items = window.AI.cleanAndParse(d.candidates[0].content.parts[0].text);
                
                // NUEVO: Verificar si cada item ya existe como favorito
                items.forEach(i => {
                    const similares = window.Logic.checkDuplicates(i);
                    if(similares.length > 0) {
                        const existente = similares[0];
                        alert(`⚠️ DETECTADO ALIMENTO PARECIDO:\n\n"${existente.n}"\n${Math.round(existente.k)} kcal\n\nYa existe en favoritos.`);
                    }
                });
                
                items.forEach(i => window.S.day[window.S.tm].push(i));
                await window.DB.setDay(); window.UI.closeAll(); window.Sys.sync();
            } catch(e) { alert("Error Imagen: " + e.message); }
            document.getElementById('loading-screen').style.display='none';
        };
    }
};

window.selectFoundItem = (i) => { 
    try {
        const s=window.S.lastSearch[i]; 
        if(s.isPlate || s.isFavorito){
            if(confirm(`¿Añadir ${s.isPlate ? 'plato' : 'favorito'} "${s.n}"?`)){
                if(s.isPlate) {
                    s.items.forEach(it=>window.S.day[window.S.tm].push(JSON.parse(JSON.stringify(it))));
                } else {
                    window.S.day[window.S.tm].push({...s, q: 100, u: 'g'});
                }
                window.Logic.autoSave();
            }
        } else {
            window.S.item=s; 
            window.UI.setQty(s); 
            window.UI.view('v-qty');
        }
    } catch(e) { console.error(e); }
};

if (document.readyState === 'complete') window.Sys.init(); else window.addEventListener('load', window.Sys.init);
