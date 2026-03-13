import { db, fire } from './firebase-config.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- 1. CONFIGURACIÓN ---
const auth = getAuth();
const provider = new GoogleAuthProvider();
const APP_NAME = "Nutr-IA";

setTimeout(() => { const s = document.getElementById('loading-screen'); if (s && s.style.display != 'none') s.style.display = 'none'; }, 4000);

const MEALS = [ { k: '01_desayuno', n: 'Desayuno', i: 'fa-coffee' }, { k: '02_almuerzo', n: 'Almuerzo', i: 'fa-bread-slice' }, { k: '03_comida', n: 'Comida', i: 'fa-utensils' }, { k: '04_merienda', n: 'Merienda', i: 'fa-apple-alt' }, { k: '05_cena', n: 'Cena', i: 'fa-moon' } ];

window.S = { 
    d: new Date(), uid: null, u: null, day: {}, workouts: [], lib: [], platos: [], allUsers: [], 
    tm: null, item: null, ref: null, 
    edit: false, eIdx: null, srcMeal: null, copyMode: 'copy', lastSearch: [], 
    plateEditIdx: -1, editLibItem: null, editLib: false, unitConfigs: {} 
};

// --- 2. SISTEMA ---
window.Sys = {
    init: async () => {
        window.UI.checkAI();
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
                
                // --- Memoria infalible del navegador ---
                let dbId = localStorage.getItem('nutria_saved_user') || user.uid; 
                
                try {
                    const q = fire.query(fire.collection(db, 'usuarios'), fire.where('uid', '==', user.uid));
                    const querySnapshot = await fire.getDocs(q);
                    if (!querySnapshot.empty) {
                        dbId = querySnapshot.docs[0].id;
                        localStorage.setItem('nutria_saved_user', dbId); // Guardar en memoria
                    } else {
                        // Si falla la búsqueda, comprobar si la memoria del navegador es correcta
                        const cacheRef = fire.doc(db, 'usuarios', dbId);
                        const cacheSnap = await fire.getDoc(cacheRef);
                        if (!cacheSnap.exists()) {
                            const nameRef = fire.doc(db, 'usuarios', user.displayName || "");
                            const nameSnap = await fire.getDoc(nameRef);
                            if (nameSnap.exists()) {
                                await fire.updateDoc(nameRef, { uid: user.uid });
                                dbId = nameSnap.id;
                                localStorage.setItem('nutria_saved_user', dbId);
                            }
                        }
                    }
                } catch(e) { console.log("Login usando memoria local"); }

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
    
    // Al cerrar sesión borramos la memoria para que otro usuario pueda entrar
    logout: async () => { localStorage.removeItem('nutria_saved_user'); await signOut(auth); location.reload(); },
    
    load: async (id, email, name) => {
        try {
            await window.DB.lib();
            let uData = await window.DB.getU(id);
            if (!uData) {
                window.UI.newProfile();
                const cleanName = name || 'Usuario';
                document.getElementById('e-name').value = cleanName;
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
    sync: async () => { 
        window.S.day = await window.DB.getDay(window.S.d); 
        window.S.workouts = await window.DB.getWorkouts(window.S.d);
        window.Render.all(); 
        if (document.getElementById('m-stats').style.display === 'flex') {
            window.Stats.updateView();
        }
    }
};

// --- 3. BASE DE DATOS ---
window.DB = {
    col: (n) => fire.collection(db, n),
    doc: (p, i) => fire.doc(db, p, i),
    
    norm: (u) => ({ id: u.name||u.uid, name: u.name||'Usuario', email: u.email, h: parseFloat(u.h||170), iw: parseFloat(u.iw||u.w||70), w: parseFloat(u.w||70), iwaist: parseFloat(u.iwaist||u.waist||0), waist: parseFloat(u.waist||0), tw: parseFloat(u.tw||75), y: parseInt(u.y||1990), g: u.g||'male', act: u.act||"1.2", mod: u.mod||"0", mac: u.customMacros || {p:null, c:null, f:null} }),
    
    setU: async (u) => { await fire.setDoc(fire.doc(db, 'usuarios', u.name), u, { merge: true }); window.S.uid = u.name; },
    getU: async (id) => { const s = await fire.getDoc(fire.doc(db, 'usuarios', id)); return s.exists() ? s.data() : null; },
    getDay: async (d) => { if(!window.S.uid) return {}; const k = d.toISOString().split('T')[0]; const s = await fire.getDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, k)); let data = s.exists() ? s.data() : {}; MEALS.forEach(m => { if (!data[m.k]) data[m.k] = [] }); return data; },
    setDay: async () => { if(!window.S.uid) return; const k = window.S.d.toISOString().split('T')[0]; await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, k), window.S.day, { merge: true }); },
    
    getWorkouts: async (d) => {
        if(!window.S.uid) return [];
        try {
            const k = d.toISOString().split('T')[0];
            const s = await fire.getDoc(fire.doc(db, 'entrenamientos_diarios', window.S.uid));
            if(s.exists() && s.data()[k]) return s.data()[k];
            return [];
        } catch(e) { return []; }
    },

    lib: async () => { 
        try {
            const sys = await fire.getDoc(fire.doc(db, 'sistema', 'biblioteca'));
            window.S.sysLib = sys.exists() ? sys.data().items : [];
        } catch(e) { window.S.sysLib = []; }

        if(!window.S.uid) { window.S.lib = []; return; }
        try {
            const priv = await fire.getDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/biblioteca`)); 
            window.S.lib = priv.exists() ? priv.data().items : []; 
        } catch(e) { window.S.lib = []; }
    },
    
    saveLib: async () => { if(!window.S.uid) return; await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/biblioteca`), { items: window.S.lib }, { merge: true }); },
    getPlates: async () => { try { if(!window.S.uid) return; const s = await fire.getDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/platos`)); window.S.platos = s.exists() ? s.data().items : []; } catch (e) { window.S.platos = []; } },
    savePlates: async () => { if(!window.S.uid) return; await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/mis_datos/platos`), { items: window.S.platos }, { merge: true }); }
};

// --- 4. UI ---
window.UI = {
    open: (id) => { const el = document.getElementById(id); if(el) el.style.display='flex'; },
    closeAll: () => { document.querySelectorAll('.modal').forEach(m=>m.style.display='none'); window.S.edit = false; window.S.editLib = false; window.S.item = null; window.S.ref = null; },
    view: (id) => { ['v-home','v-conf','v-qty','v-json','v-import'].forEach(x=>{ const el = document.getElementById(x); if(el) el.style.display='none'; }); const target = document.getElementById(id); if(target) target.style.display='block'; },
    checkAI: () => { const k = localStorage.getItem('t_ai_key'); if(k) { document.getElementById('btn-config-ai').classList.add('configured'); const input = document.getElementById('ai-key'); if(input) input.value = k; } },
    
    populateInputs: (item) => {
        try {
            const val = (id, v) => { const el = document.getElementById(id); if(el) el.value = (v === undefined || v === null) ? '' : v; };
            val('qty-name-in', item.n); val('qty-in', item.q); val('unit-in', item.u || 'g');
            val('calc-kcal', Math.round(item.k)); val('calc-p', Math.round(item.p)); val('calc-c', Math.round(item.c)); val('calc-f', Math.round(item.f));
            if(item.baseWeight && item.u !== 'g' && item.u !== 'ml') { document.getElementById('unit-config-section').style.display = 'block'; val('unit-weight', item.baseWeight); } 
            else { document.getElementById('unit-config-section').style.display = 'none'; }
        } catch(e) { console.error("UI Populate Error:", e); }
    },

    openProfile: () => {
        if(!window.S.u) return; const u=window.S.u;
        document.getElementById('e-name').value=u.name; 
        document.getElementById('e-h').value=u.h; 
        document.getElementById('e-y').value=u.y; 
        document.getElementById('e-iw').value=u.iw||u.w; 
        document.getElementById('e-w').value=u.w; 
        document.getElementById('e-iwaist').value=u.iwaist||u.waist||''; 
        document.getElementById('e-waist').value=u.waist||''; 
        document.getElementById('e-tw').value=u.tw||75;
        document.getElementById('e-g').value=u.g; 
        document.getElementById('e-act').value=u.act; 
        document.getElementById('e-mod').value=u.mod;
        document.getElementById('pp').value=u.mac.p; document.getElementById('pc').value=u.mac.c; document.getElementById('pf').value=u.mac.f;
        window.Calc.live(); window.UI.open('m-prof');
    },
    newProfile: () => { window.S.u=null; document.querySelectorAll('#m-prof input').forEach(i=>i.value=''); window.UI.open('m-prof'); },
    
    showToast: (msg, isWarn = false) => {
        const t = document.getElementById('toast'); if(!t) return;
        t.innerText = msg; t.style.background = isWarn ? '#f59e0b' : '#10b981';
        t.style.boxShadow = isWarn ? '0 10px 25px rgba(245, 158, 11, 0.4)' : '0 10px 25px rgba(16, 185, 129, 0.4)';
        t.style.bottom = '100px'; t.style.opacity = '1';
        setTimeout(() => { t.style.bottom = '-50px'; t.style.opacity = '0'; }, 3000);
    }
};

// --- 5. CALC ---
window.Calc = {
    bio: () => { 
        if(!window.S.u) return; 
        const h=window.S.u.h, w=window.S.u.w;
        const year = window.S.u.y || 1990; 
        const age = new Date().getFullYear() - year;
        
        let bmr = (10*w) + (6.25*h) - (5*age) + (window.S.u.g=='male'?5:-161);
        const maintenance = Math.round(bmr * parseFloat(window.S.u.act));
        const goal = maintenance + parseInt(window.S.u.mod);
        
        window.S.u.calc = { goal: goal, maintenance: maintenance }; 

        if(window.S.u.mac && window.S.u.mac.p){
            window.S.u.calc.p = Math.round((goal * (window.S.u.mac.p / 100)) / 4);
            window.S.u.calc.c = Math.round((goal * (window.S.u.mac.c / 100)) / 4);
            window.S.u.calc.f = Math.round((goal * (window.S.u.mac.f / 100)) / 9);
        } else {
            window.S.u.calc.p = Math.round(w*2); 
            window.S.u.calc.f = Math.round(w*0.9); 
            window.S.u.calc.c = Math.round((goal-(window.S.u.calc.p*4)-(window.S.u.calc.f*9))/4);
        }
        window.Render.all();
    },
    
    live: () => {
        const val=(id)=>parseFloat(document.getElementById(id).value)||0; 
        const h=val('e-h'), w=val('e-w')||val('e-iw'), year=val('e-y'); 
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
        if(window.S.u) document.getElementById('h-av').innerText = window.S.u.name.charAt(0).toUpperCase();
        let t={k:0, p:0, c:0, f:0}; Object.values(window.S.day).forEach(arr=>{if(Array.isArray(arr))arr.forEach(i=>{t.k+=i.k;t.p+=i.p;t.c+=i.c;t.f+=i.f;});});
        
        if(!window.S.u||!window.S.u.calc)return;
        
       // --- NUEVA LÓGICA DE BONUS SEPARADA ---
        let burnedKcal = 0;
        if (window.S.workouts) { window.S.workouts.forEach(w => { burnedKcal += (w.kcal || 0); }); }
        let bonus = burnedKcal >= 350 ? burnedKcal - 350 : 0;

        const tg = window.S.u.calc; 
        const goal = tg.goal; // META ESTRICTA BASE
        const maintenance = tg.maintenance || goal;
        
        // Cálculos
        let diff = goal - t.k; 
        let bonusUsado = t.k > goal ? Math.min(t.k - goal, bonus) : 0;
        let bonusRestante = Math.max(0, bonus - bonusUsado);
        
        let bonusHtml = '';
        if (bonus > 0) {
            // Texto del bonus superior ahora es Verde
            bonusHtml += `<div style="color:#10b981; display:flex; align-items:center; gap:5px" title="Bonus Disponible"><i class="fas fa-running"></i> Bonus: +${Math.round(bonus)}</div>`;
        }

        const bioHtml = `
            <div class="top-stat-bar" style="display:flex; justify-content:center; flex-wrap:wrap; gap:15px; font-weight:700; font-size:0.9rem; margin-bottom:10px;">
            <div style="color:#f59e0b; display:flex; align-items:center; gap:5px"><i class="fas fa-fire"></i> Mant: ${maintenance}</div>
            <div style="color:#3b82f6; display:flex; align-items:center; gap:5px"><i class="fas fa-bullseye"></i> Meta Base: ${goal}</div>
                ${bonusHtml}
            </div>`;
        document.getElementById('bio-txt').innerHTML = bioHtml;

        const ring = document.getElementById('ring-bg');
        const ringIn = document.querySelector('#ring-bg .ring-in');
        const lbl = document.getElementById('l-restan');
        const val = document.getElementById('v-rem');
        lbl.style.color = ""; val.style.color = ""; 
        
        ringIn.style.position = 'relative';
        ringIn.style.zIndex = '10';
        
        let innerRing = document.getElementById('inner-bonus-ring');
        if(!innerRing) {
            innerRing = document.createElement('div');
            innerRing.id = 'inner-bonus-ring';
            innerRing.style.position = 'absolute';
            innerRing.style.inset = '6px';
            innerRing.style.borderRadius = '50%';
            innerRing.style.zIndex = '1'; 
            ring.insertBefore(innerRing, ring.firstChild);
        }
        
        let extraTxt = document.getElementById('v-bonus-txt');
        if(!extraTxt) {
            extraTxt = document.createElement('div');
            extraTxt.id = 'v-bonus-txt';
            extraTxt.style.fontWeight = '900';
            extraTxt.style.fontSize = '0.75rem';
            extraTxt.style.marginTop = '4px';
            ringIn.appendChild(extraTxt);
        }

        // LÓGICA DE COLORES DEL ANILLO (Azul, Morado, Verde, Rojo)
        if (t.k <= goal) {
            // Estás dentro de la base: Morado consumido, Azul restante
            ring.classList.remove('danger');
            lbl.innerText = "RESTAN (BASE)"; val.innerText = Math.round(goal - t.k);
            const pct = (t.k / goal) * 100;
            ring.style.background = `conic-gradient(#8b5cf6 0% ${pct}%, #3b82f6 ${pct}% 100%)`; 
            
            if (bonus > 0) {
                extraTxt.style.display = 'block'; extraTxt.style.color = '#10b981';
                extraTxt.innerText = `+${Math.round(bonus)} BONUS`;
                innerRing.style.background = `conic-gradient(#10b981 0% 100%)`; // Bonus entero verde
            } else { extraTxt.style.display = 'none'; innerRing.style.background = 'transparent'; }
            
        } else {
            // Te has pasado de la base.
            if (bonus > 0 && t.k <= (goal + bonus)) {
                // Usando bonus: El anillo principal base se vuelve Morado completo
                ring.classList.remove('danger');
                ring.style.background = `conic-gradient(#8b5cf6 0% 100%)`; 
                
                lbl.innerText = "USANDO BONUS"; val.innerText = Math.round(bonusRestante);
                extraTxt.style.display = 'block'; extraTxt.style.color = '#10b981';
                extraTxt.innerText = `USADO: ${Math.round(bonusUsado)}`;
                
                // Anillo interno: Verde Oscuro (gastado) y Verde Normal (restante)
                const pctBonus = (bonusUsado / bonus) * 100;
                innerRing.style.background = `conic-gradient(#059669 0% ${pctBonus}%, #10b981 ${pctBonus}% 100%)`; 
            } else {
                // Exceso total: Se pinta TODO de rojo
                let excesoTotal = t.k > (goal + bonus) ? t.k - (goal + bonus) : (t.k - goal);
                lbl.innerText = "EXCESO"; val.innerText = Math.round(excesoTotal);
                
                ring.classList.add('danger');
                ring.style.background = `conic-gradient(#ef4444 0% 100%)`; // Rojo base
                
                if (bonus > 0) {
                    extraTxt.style.display = 'block'; extraTxt.style.color = '#ef4444';
                    extraTxt.innerText = `BONUS AGOTADO`;
                    innerRing.style.background = `conic-gradient(#ef4444 0% 100%)`; // Rojo interno
                } else { extraTxt.style.display = 'none'; innerRing.style.background = 'transparent'; }
            }
        }
        
        document.getElementById('v-p').innerText=`${Math.round(t.p)}/${Math.round(tg.p)}`; document.getElementById('b-p').style.width=Math.min((t.p/tg.p)*100,100)+'%'; 
        document.getElementById('v-c').innerText=`${Math.round(t.c)}/${Math.round(tg.c)}`; document.getElementById('b-c').style.width=Math.min((t.c/tg.c)*100,100)+'%'; 
        document.getElementById('v-f').innerText=`${Math.round(t.f)}/${Math.round(tg.f)}`; document.getElementById('b-f').style.width=Math.min((t.f/tg.f)*100,100)+'%';
        
        const feed=document.getElementById('feed'); feed.innerHTML='';
        const shortDate = window.S.d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });

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
                    <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <div style="font-size:1.1rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:8px;">
                            <i class="fas ${m.i}"></i> ${m.n}
                            <span style="font-size:0.8rem; font-weight:700; color:#64748b; background:#f1f5f9; border:1px solid #e2e8f0; padding:2px 8px; border-radius:12px; margin-left:4px; text-transform:capitalize;">${shortDate}</span>
                        </div>
                        <span style="background:#0f172a; color:white; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.9rem;">${Math.round(mk)} kcal</span>
                    </div>
                    <div style="display:flex; gap:6px; width:100%; flex-wrap:nowrap;">
                        <span style="${pPro} flex:1; justify-content:center;">P: ${Math.round(mp)}g</span>
                        <span style="${pCar} flex:1; justify-content:center;">C: ${Math.round(mc)}g</span>
                        <span style="${pFat} flex:1; justify-content:center;">G: ${Math.round(mf)}g</span>
                    </div>
                    <div style="display:flex; justify-content:flex-end; width:100%;">
                        <div style="display:flex;">
                            <button style="${sPlate}" onclick="window.Logic.openCreatePlate('${m.k}')" title="Crear Plato"><i class="fas fa-utensils"></i></button>
                            <button style="${sCopy}" onclick="window.Logic.openCopy('${m.k}','copy', this)" title="Copiar"><i class="fas fa-copy"></i></button>
                            <button style="${sMove}" onclick="window.Logic.openCopy('${m.k}','move', this)" title="Mover"><i class="fas fa-calendar-alt"></i></button>
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
    
    filterType: 'all',      
    showGlobal: false,      

    saveUser: async () => {
        const n = document.getElementById('e-name').value; 
        if (!n) return alert("Nombre obligatorio"); 
        try { 
            const realUid = auth.currentUser ? auth.currentUser.uid : window.S.uid; 
            const val = (id) => parseFloat(document.getElementById(id).value); 
            const u = { 
                uid: realUid, name: n, email: auth.currentUser ? auth.currentUser.email : "", 
                h: val('e-h'), iw: val('e-iw'), w: window.S.u ? window.S.u.w : val('e-iw'), 
                iwaist: val('e-iwaist'), waist: window.S.u ? window.S.u.waist : val('e-iwaist'),
                tw: val('e-tw'), y: val('e-y'), 
                g: document.getElementById('e-g').value, act: val('e-act'), mod: val('e-mod'), 
                customMacros: { p: val('pp'), c: val('pc'), f: val('pf') } 
            }; 
            await fire.setDoc(fire.doc(db, 'usuarios', n), u, { merge: true }); 
            
            // Le grabamos a fuego al navegador quién eres
            localStorage.setItem('nutria_saved_user', n);

            window.S.u = window.DB.norm(u); window.S.uid = n; window.Calc.bio(); window.UI.closeAll(); location.reload(); 
        } catch (e) { alert("Error: " + e.message); }
    },
    openAdd: (mk) => { 
        window.S.tm = mk; window.S.edit = false; window.S.editLib = false; window.S.ref = null;
        window.UI.view('v-home'); window.UI.open('m-add'); 
        document.getElementById('src-in').value = '';
        window.S.showGlobal = false; window.Logic.setFilter('all'); 
    },

    setFilter: (type) => {
        window.Logic.filterType = type;
        ['btn-t-all', 'btn-t-food', 'btn-t-plate'].forEach(id => {
            const el = document.getElementById(id); if(el) el.classList.remove('active');
        });
        const activeBtn = document.getElementById('btn-t-' + type); if(activeBtn) activeBtn.classList.add('active');
        window.Logic.search(); 
    },

    toggleGlobalSearch: () => { window.S.showGlobal = !window.S.showGlobal; window.Logic.search(); },

    search: () => {
        const q = document.getElementById('src-in').value.toLowerCase();
        const b = document.getElementById('res-list'); b.innerHTML = '';
        const misPlatos = window.S.platos || []; const misAlimentos = window.S.lib || []; const globalAlimentos = window.S.sysLib || []; 
        let results = [];

        if(window.Logic.filterType === 'all' || window.Logic.filterType === 'plate') results.push(...misPlatos.map(p => ({...p, isPlate: true, isMine: true})));
        if(window.Logic.filterType === 'all' || window.Logic.filterType === 'food') results.push(...misAlimentos.map(f => ({...f, isMine: true})));
        if(window.S.showGlobal && (window.Logic.filterType === 'all' || window.Logic.filterType === 'food')) results.push(...globalAlimentos.map(f => ({...f, isMine: false})));

        results = results.filter(x => x.n.toLowerCase().includes(q));
        results.sort((a,b) => a.n.localeCompare(b.n));

        if(results.length === 0) b.innerHTML = '<div style="padding:30px; text-align:center; color:#94a3b8; font-style:italic">No se encontraron resultados.</div>';

        results.forEach((f, i) => {
            let icon = f.isPlate ? '<span style="color:#d97706">🍽️ Plato</span>' : (f.isMine ? '<span style="color:#f59e0b">⭐ Favorito</span>' : '<span style="color:#94a3b8">☁️ Global</span>');
            const bgStyle = f.isMine ? 'background:#fffbeb;' : ''; 
            b.innerHTML += `
            <div class="food-suggestion" style="display:flex; justify-content:space-between; align-items:center; ${bgStyle}">
                <div onclick="window.Logic.selectFoundItem(${i})" style="flex:1; cursor:pointer">
                    <div style="font-size:0.75rem; margin-bottom:2px">${icon}</div>
                    <b style="font-size:1.1rem; color:#0f172a">${f.n}</b> 
                    <div style="color:#64748b; font-size:0.9rem; margin-top:2px">${f.q} ${f.u} · <b>${Math.round(f.k)} kcal</b> · P${Math.round(f.p)}</div>
                </div>
                <div style="display:flex; gap:10px; padding-left:15px; align-items:center">
                    <button onclick="event.stopPropagation(); window.Logic.openEditLib(${i})" style="border:none; background:rgba(0,0,0,0.05); width:40px; height:40px; border-radius:10px; cursor:pointer; color:#64748b; font-size:1.1rem; display:flex; align-items:center; justify-content:center">✏️</button>
                    <button onclick="event.stopPropagation(); window.Logic.delFromDb(${i})" style="border:none; background:#fef2f2; width:40px; height:40px; border-radius:10px; cursor:pointer; color:#ef4444; font-size:1.1rem; display:flex; align-items:center; justify-content:center">🗑️</button>
                </div>
            </div>`;
        });
        window.S.lastSearch = results;
        const toggleText = window.S.showGlobal ? "Ocultar catálogo global" : "🌐 Buscar en catálogo global";
        b.innerHTML += `<div style="margin-top:20px; text-align:center;"><button onclick="window.Logic.toggleGlobalSearch()" style="background:none; border:1px solid #cbd5e1; padding:10px 20px; border-radius:20px; color:#64748b; cursor:pointer; font-size:0.9rem">${toggleText}</button></div>`;
    },

    selectFoundItem: (i) => {
        const item = window.S.lastSearch[i];
        if (item.isPlate) {
            if(confirm(`¿Añadir plato "${item.n}" completo?`)){ item.items.forEach(it => window.S.day[window.S.tm].push(it)); window.Logic.autoSave(); window.UI.closeAll(); }
        } else {
            window.S.item = { ...item }; window.S.ref = { q: item.q || 100, u: item.u || 'g', k: item.k, p: item.p, c: item.c, f: item.f };
            window.UI.populateInputs(window.S.item); window.UI.view('v-qty');
        }
    },

    smartCalc: () => {
        const u = document.getElementById('unit-in').value; const isStd = (u === 'g' || u === 'ml');
        const configSection = document.getElementById('unit-config-section');
        if (configSection) {
            if (!isStd && configSection.style.display === 'none') document.getElementById('qty-in').value = 1;
            configSection.style.display = isStd ? 'none' : 'block';
        }
        if (!window.S.ref) return;
        const qty = parseFloat(document.getElementById('qty-in').value) || 0;
        const weight = parseFloat(document.getElementById('unit-weight').value) || 0;
        const baseQ = window.S.ref.q || 100;
        let totalGrams = 0;
        if (isStd) totalGrams = qty; else if (weight > 0) totalGrams = weight * qty;
        if (totalGrams === 0 && qty !== 0) return;
        const ratio = totalGrams / baseQ;
        document.getElementById('calc-kcal').value = Math.round(window.S.ref.k * ratio);
        document.getElementById('calc-p').value = Math.round(window.S.ref.p * ratio);
        document.getElementById('calc-c').value = Math.round(window.S.ref.c * ratio);
        document.getElementById('calc-f').value = Math.round(window.S.ref.f * ratio);
    },
    
    updateCalculations: () => { window.Logic.smartCalc(); },
    updateUnitDisplay: () => { window.Logic.smartCalc(); },
    recalcFromWeight: () => { window.Logic.smartCalc(); },

    saveItem: async () => {
        if(window.S.editLib) return window.Logic.saveLibEdit();
        const n = document.getElementById('qty-name-in').value, q = parseFloat(document.getElementById('qty-in').value), u = document.getElementById('unit-in').value, k = parseFloat(document.getElementById('calc-kcal').value)||0, p = parseFloat(document.getElementById('calc-p').value)||0, c = parseFloat(document.getElementById('calc-c').value)||0, f = parseFloat(document.getElementById('calc-f').value)||0, bw = parseFloat(document.getElementById('unit-weight').value) || null;
        const entry = { n, q, u, k, p, c, f, baseWeight: bw };
        if(window.S.edit) window.S.day[window.S.tm][window.S.eIdx] = entry; else window.S.day[window.S.tm].push(entry);
        await window.DB.setDay(); window.UI.closeAll(); window.Sys.sync();
    },

    saveCurrentToLib: async () => {
        const n = document.getElementById('qty-name-in').value; if(!n) return alert("Ponle nombre");
        const q = parseFloat(document.getElementById('qty-in').value), u = document.getElementById('unit-in').value, k = parseFloat(document.getElementById('calc-kcal').value), p = parseFloat(document.getElementById('calc-p').value), c = parseFloat(document.getElementById('calc-c').value), f = parseFloat(document.getElementById('calc-f').value), bw = parseFloat(document.getElementById('unit-weight').value); 
        const newItem = { n, q, u, k, p, c, f, baseWeight: bw };
        const idx = window.S.lib.findIndex(x => x.n.toLowerCase() === n.toLowerCase());
        if(idx >= 0) { if(confirm("Ya existe en TUS favoritos. ¿Sobrescribir?")) window.S.lib[idx] = newItem; else return; } else { window.S.lib.push(newItem); }
        await window.DB.saveLib(); alert("¡Guardado en TU lista privada!"); window.UI.view('v-home'); window.Logic.search(); 
    },

    editItem: (mk, i) => {
        window.S.edit = true; window.S.tm = mk; window.S.eIdx = i; const item = window.S.day[mk][i]; window.S.item = { ...item };
        window.S.ref = { q: item.q || 1, u: item.u, k: item.k, p: item.p, c: item.c, f: item.f };
        window.UI.populateInputs(item); window.UI.view('v-qty'); window.UI.open('m-add');
    },

    delFromDb: async (i) => {
        const item = window.S.lastSearch[i]; 
        if(!confirm(`¿Borrar "${item.n}" permanentemente de la base de datos?`)) return;
        if(item.isPlate) { window.S.platos = window.S.platos.filter(p => p.n !== item.n); await window.DB.savePlates(); } 
        else if (item.isMine) { window.S.lib = window.S.lib.filter(l => l.n !== item.n); await window.DB.saveLib(); } 
        else { window.S.sysLib = window.S.sysLib.filter(l => l.n !== item.n); await fire.setDoc(fire.doc(db, 'sistema', 'biblioteca'), { items: window.S.sysLib }); }
        window.Logic.search();
    },

    openEditLib: (i) => {
        const item = window.S.lastSearch[i]; window.S.editLib = true; window.S.editLibItem = item; window.S.item = item;
        window.S.ref = { q: item.q || 100, u: item.u || 'g', k: item.k, p: item.p, c: item.c, f: item.f };
        window.UI.populateInputs(item); window.UI.view('v-qty'); window.UI.open('m-add');
    },

    saveLibEdit: async () => {
        const n = document.getElementById('qty-name-in').value, q = parseFloat(document.getElementById('qty-in').value), u = document.getElementById('unit-in').value, k = parseFloat(document.getElementById('calc-kcal').value), p = parseFloat(document.getElementById('calc-p').value), c = parseFloat(document.getElementById('calc-c').value), f = parseFloat(document.getElementById('calc-f').value), bw = parseFloat(document.getElementById('unit-weight').value);
        const newItem = { n, q, u, k, p, c, f, baseWeight: bw };
        if(window.S.editLibItem.isPlate) { const idx = window.S.platos.findIndex(x=>x.n===window.S.editLibItem.n); if(idx >= 0) window.S.platos[idx].n = n; await window.DB.savePlates(); } 
        else { const idx = window.S.lib.findIndex(x=>x.n === window.S.editLibItem.n); if(idx >= 0) window.S.lib[idx] = newItem; else window.S.lib.push(newItem); await window.DB.saveLib(); }
        window.UI.view('v-home'); window.Logic.search();
    },

    saveUnitConfig: () => { alert("Configuración lista."); },
    delItem: async (mk,i) => { if(confirm("Borrar?")){window.S.day[mk].splice(i,1); await window.DB.setDay(); window.Sys.sync();}},
    wipeMeal: async (mk) => { if(confirm("Vaciar?")){window.S.day[mk]=[]; await window.DB.setDay(); window.Sys.sync();}},
    
    openCopy: (mk, t, btnEl) => { 
        if(btnEl) { const originalHTML = btnEl.innerHTML; btnEl.innerHTML = '<i class="fas fa-check"></i>'; btnEl.style.transform = 'scale(0.8)'; setTimeout(() => { btnEl.innerHTML = originalHTML; btnEl.style.transform = 'scale(1)'; }, 600); }
        window.S.srcMeal=mk; window.S.copyMode=t; 
        document.getElementById('copy-date').valueAsDate=window.S.d; 
        document.getElementById('copy-meal').value=mk; 
        const nombresComidas = { '01_desayuno': 'desayuno', '02_almuerzo': 'almuerzo', '03_comida': 'comida', '04_merienda': 'merienda', '05_cena': 'cena' };
        const nombre = nombresComidas[mk] || 'comida';
        const modal = document.getElementById('m-copy');
        modal.querySelector('h3').innerText = (t === 'move' ? 'Mover ' : 'Copiar ') + nombre.charAt(0).toUpperCase() + nombre.slice(1);
        modal.querySelector('label').innerText = 'Elige un día al que quieres ' + (t === 'move' ? 'mover tu ' : 'copiar tu ') + nombre + ':';
        window.UI.open('m-copy'); 
    },
    
    execCopy: async () => { 
        const d=document.getElementById('copy-date').value, tm=document.getElementById('copy-meal').value, r=fire.doc(db,`usuarios/${window.S.uid}/diario`,d), s=await fire.getDoc(r); 
        let da=s.exists()?s.data():{}; 
        if(!da[tm])da[tm]=[]; 
        da[tm]=da[tm].concat(window.S.day[window.S.srcMeal]); 
        await fire.setDoc(r,da); 
        if(window.S.copyMode=='move'){window.S.day[window.S.srcMeal]=[]; await window.DB.setDay();} 
        window.UI.closeAll(); 
        if(d===window.S.d.toISOString().split('T')[0]) window.Sys.sync(); 
        window.UI.showToast(window.S.copyMode === 'move' ? '🚀 Movido correctamente' : '📋 Copiado correctamente');
    },

    openCreatePlate: (mk) => { window.S.srcMeal=mk; const c=document.getElementById('plate-ingredients-list'); c.innerHTML=''; window.S.day[mk].forEach((it,i)=>{c.innerHTML+=`<div class="plate-check-row"><span>${it.n}</span><input type="checkbox" value="${i}" checked></div>`}); window.UI.open('m-create-plate'); },
    savePlateToDb: async () => { const n=document.getElementById('plate-name').value; const chk=document.querySelectorAll('#plate-ingredients-list input:checked'); let its=[],tk=0,tp=0,tc=0,tf=0; chk.forEach(c=>{const i=window.S.day[window.S.srcMeal][c.value]; its.push(i); tk+=i.k; tp+=i.p; tc+=i.c; tf+=i.f;}); window.S.platos.push({n, k:tk, p:tp, c:tc, f:tf, items:its}); await window.DB.savePlates(); window.UI.closeAll(); alert("Plato guardado"); },
    openItemAct: (mk,i) => { window.S.tm=mk; window.S.eIdx=i; window.S.item=window.S.day[mk][i]; document.getElementById('ia-name').innerText=window.S.item.n; document.getElementById('ia-date').valueAsDate=window.S.d; document.getElementById('ia-meal').value=mk; window.UI.open('m-item-act'); },
    execItemAct: async (m) => { const d=document.getElementById('ia-date').value, tm=document.getElementById('ia-meal').value; let td=(d===window.S.d.toISOString().split('T')[0])?window.S.day:(await fire.getDoc(fire.doc(db,`usuarios/${window.S.uid}/diario`,d))).data()||{}; if(!td[tm])td[tm]=[]; td[tm].push(window.S.item); if(m=='move')window.S.day[window.S.tm].splice(window.S.eIdx,1); await fire.setDoc(fire.doc(db,`usuarios/${window.S.uid}/diario`,d),td); await window.DB.setDay(); window.UI.closeAll(); window.Sys.sync(); },
    pdf: () => { const el = document.getElementById('feed'); if(!el || el.innerText.trim() === "") return alert("Vacío"); const opt = { margin: 10, filename: `Diario_${window.S.d.toISOString().split('T')[0]}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }; html2pdf().set(opt).from(el).save(); },
    pdfHistory: async () => { if(!confirm("Generar historial completo?")) return; document.getElementById('loading-screen').style.display='flex'; try { const q = await fire.getDocs(fire.query(fire.collection(db, `usuarios/${window.S.uid}/diario`), fire.orderBy('__name__'))); let html = `<div style="padding:20px; font-family:sans-serif;"><h1>Historial - ${window.S.u.name}</h1><table style="width:100%; border-collapse:collapse; font-size:12px;"><tr style="background:#0f172a; color:white;"><th style="padding:8px">Fecha</th><th>Kcal</th><th>P</th><th>C</th><th>G</th><th>Peso</th><th>Cintura</th></tr>`; q.forEach(doc => { const d = doc.data(); let tk=0, tp=0, tc=0, tf=0; MEALS.forEach(m => { if(d[m.k]) d[m.k].forEach(i => { tk+=i.k; tp+=i.p; tc+=i.c; tf+=i.f; }); }); if(tk>0) html += `<tr><td style="padding:8px;border-bottom:1px solid #ddd">${doc.id}</td><td style="text-align:center;border-bottom:1px solid #ddd">${Math.round(tk)}</td><td style="text-align:center;border-bottom:1px solid #ddd">${Math.round(tp)}</td><td style="text-align:center;border-bottom:1px solid #ddd">${Math.round(tc)}</td><td style="text-align:center;border-bottom:1px solid #ddd">${Math.round(tf)}</td><td style="text-align:center;border-bottom:1px solid #ddd">${d.weight||'-'}</td><td style="text-align:center;border-bottom:1px solid #ddd">${d.waist||'-'}</td></tr>`; }); html += `</table></div>`; const tempDiv = document.createElement('div'); tempDiv.innerHTML = html; document.body.appendChild(tempDiv); await html2pdf().set({ margin: 10, filename: `Historial_${window.S.u.name}.pdf`, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' } }).from(tempDiv).save(); document.body.removeChild(tempDiv); } catch(e) { alert("Error: " + e.message); } document.getElementById('loading-screen').style.display='none'; },
    
    exportJSON: async () => { 
        document.getElementById('loading-screen').style.display='flex'; 
        try { 
            // 1. Historial del Diario
            const q = await fire.getDocs(fire.collection(db, `usuarios/${window.S.uid}/diario`)); 
            let history = {}; 
            q.forEach(doc => { history[doc.id] = doc.data(); }); 
            
            // 2. Medidas y Análisis Corporal
            const medidasRef = fire.doc(db, "medidas_corporales", window.S.uid);
            const medidasSnap = await fire.getDoc(medidasRef);
            let medidasHistory = [];
            if (medidasSnap.exists() && medidasSnap.data().registros) { medidasHistory = medidasSnap.data().registros; }
            
            // 3. Entrenamientos y Pasos
            const entrenosRef = fire.doc(db, "entrenamientos_diarios", window.S.uid);
            const entrenosSnap = await fire.getDoc(entrenosRef);
            let entrenosHistory = {};
            if (entrenosSnap.exists()) { 
                entrenosHistory = entrenosSnap.data(); 
                delete entrenosHistory.ultima_modificacion; 
            }

            // 4. Paquete Global
            const exportData = { 
                user: window.S.u, 
                history: history, 
                medidas: medidasHistory,
                entrenamientos: entrenosHistory
            };
            
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2)); 
            const a = document.createElement('a'); a.href = dataStr; a.download = `Backup_Global_${window.S.u.name}.json`; 
            document.body.appendChild(a); a.click(); a.remove(); 
        } catch(e) { alert("Error al exportar: " + e.message); } 
        document.getElementById('loading-screen').style.display='none'; 
    },

    importJSON: (input) => { 
        const file = input.files[0]; if(!file) return; 
        const reader = new FileReader(); 
        reader.onload = async (e) => { 
            try { 
                const json = JSON.parse(e.target.result); 
                document.getElementById('loading-screen').style.display='flex'; 
                if(json.history && confirm("¿Restaurar Historial Completo (Comidas y Medidas)?")) { 
                    const batch = fire.writeBatch(db); 
                    Object.entries(json.history).forEach(([d, v]) => batch.set(fire.doc(db, `usuarios/${window.S.uid}/diario`, d), v)); 
                    if (json.medidas && json.medidas.length > 0) {
                        const medidasRef = fire.doc(db, "medidas_corporales", window.S.uid);
                        batch.set(medidasRef, { registros: json.medidas, ultima_actualizacion: new Date() }, { merge: true });
                    }
                    await batch.commit(); alert("✅ Historial restaurado"); window.Sys.sync(); 
                } else if (!json.history) { 
                    await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, window.S.d.toISOString().split('T')[0]), json); 
                    alert("Día Importado"); window.Sys.sync(); 
                } 
            } catch(e) { alert("Error JSON: " + e.message); } 
            document.getElementById('loading-screen').style.display='none'; 
        }; 
        reader.readAsText(file); 
    },
    wipe: async () => { if(confirm("Borrar día?")) { await fire.setDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, window.S.d.toISOString().split('T')[0]), {}); window.Sys.sync(); window.UI.closeAll(); }},
    execImport: async () => { const d = document.getElementById('imp-date').value, m = document.getElementById('imp-meal').value; const s = await fire.getDoc(fire.doc(db, `usuarios/${window.S.uid}/diario`, d)); if(s.exists() && s.data()[m]) { window.S.day[m] = [...(window.S.day[m]||[]), ...s.data()[m]]; await window.DB.setDay(); window.UI.closeAll(); window.Sys.sync(); } else alert("Sin datos"); }
};

// --- 8. STATS ---
window.Stats = {
    open: () => { document.getElementById('st-date').valueAsDate = window.S.d; window.Stats.updateView(); window.UI.open('m-stats'); },
    changeDate: (n) => { 
        const d = new Date(document.getElementById('st-date').value); 
        d.setDate(d.getDate() + n); 
        document.getElementById('st-date').valueAsDate = d; 
        window.Stats.updateView(); 
    },
    saveWeight: async () => {
        const wVal = parseFloat(document.getElementById('w-today').value);
        const waistVal = parseFloat(document.getElementById('waist-today').value);
        
        // ELIMINAMOS EL BLOQUEO: Ya no da error si está vacío, ahora procede a borrar.
        const dStr = document.getElementById('st-date').value;
        const ref = fire.doc(db, `usuarios/${window.S.uid}/diario`, dStr);
        
        // 1. Guardar en el diario (o establecer como null para borrarlos)
        let updateData = {
            weight: wVal > 0 ? wVal : null,
            waist: waistVal > 0 ? waistVal : null
        };

        await fire.setDoc(ref, updateData, { merge: true });
        
        if (dStr === window.S.d.toISOString().split('T')[0]) {
            window.S.day.weight = wVal > 0 ? wVal : null;
            window.S.day.waist = waistVal > 0 ? waistVal : null;
        }
        
        // 2. Sincronizar (o borrar) en el Tracker de Medidas (Silueta)
        try {
            const medidasRef = fire.doc(db, "medidas_corporales", window.S.uid);
            const medidasSnap = await fire.getDoc(medidasRef);
            let registros = [];
            if (medidasSnap.exists() && medidasSnap.data().registros) {
                registros = medidasSnap.data().registros;
            }
            
            let recIndex = registros.findIndex(r => r.date === dStr);
            
            if (recIndex >= 0) {
                // Si el registro existe, actualizamos o borramos sus propiedades
                if (wVal > 0) registros[recIndex]['Peso'] = wVal; 
                else delete registros[recIndex]['Peso'];
                
                if (waistVal > 0) registros[recIndex]['Abdomen (Ombligo)'] = waistVal;
                else delete registros[recIndex]['Abdomen (Ombligo)'];
                
                // Si al borrar nos hemos quedado solo con la fecha (vacío), borramos el registro entero de ese día
                if (Object.keys(registros[recIndex]).length <= 1) {
                    registros.splice(recIndex, 1);
                }
            } else if (wVal > 0 || waistVal > 0) {
                // Crear un registro nuevo solo si estamos añadiendo datos reales
                let rec = { date: dStr };
                if (wVal > 0) rec['Peso'] = wVal;
                if (waistVal > 0) rec['Abdomen (Ombligo)'] = waistVal;
                registros.push(rec);
            }
            
            registros.sort((a, b) => new Date(b.date) - new Date(a.date));
            await fire.setDoc(medidasRef, { registros: registros, ultima_actualizacion: new Date() }, { merge: true });
        } catch(e) { console.error("Error al sincronizar con silueta:", e); }

        // 3. Auto-actualizar el perfil (Solo lo hacemos si introduces un dato. Si estás borrando, no tocamos tu perfil principal)
        if (window.S.u && (wVal > 0 || waistVal > 0)) {
            let userUpdated = false;
            if (wVal > 0) { window.S.u.w = wVal; if (!window.S.u.iw) window.S.u.iw = wVal; userUpdated = true; }
            if (waistVal > 0) { window.S.u.waist = waistVal; if (!window.S.u.iwaist) window.S.u.iwaist = waistVal; userUpdated = true; }

            if (userUpdated) {
                await fire.setDoc(fire.doc(db, 'usuarios', window.S.uid), window.S.u, { merge: true }); 
                window.Calc.bio(); 
            }
        }

        // Mostramos un mensaje diferente si ha guardado o si ha borrado
        const estaBorrando = (!wVal || wVal <= 0) && (!waistVal || waistVal <= 0);
        window.UI.showToast(estaBorrando ? '🗑️ Medidas de este día eliminadas' : '⚖️ Medidas guardadas y sincronizadas'); 
        
        window.Stats.updateView();
    },
   updateView: async () => {
        try {
            const dateInput = document.getElementById('st-date').value;
            const dStr = dateInput || window.S.d.toISOString().split('T')[0];
            if (!dateInput) document.getElementById('st-date').value = dStr;

            const q = await fire.getDocs(fire.query(fire.collection(db, `usuarios/${window.S.uid}/diario`), fire.orderBy('__name__')));
            const hist = []; q.forEach(x=>hist.push({id:x.id, ...x.data()}));
            
            const cur = hist.find(x=>x.id===dStr); 
            document.getElementById('w-today').value = cur && cur.weight ? cur.weight : '';
            document.getElementById('waist-today').value = cur && cur.waist ? cur.waist : '';
            
            const fb = document.getElementById('w-feedback'); let html = '';
            let firstW=window.S.u.w; let prevW=null, currW=cur?cur.weight:null;
            for(let h of hist){ if(h.weight){ firstW = h.weight; break; } }
            for(let h of hist){ if(h.weight && h.id < dStr) prevW = h.weight; }
            if(currW) {
                // Aquí están los 2 decimales correctos (.toFixed(2))
                const diff = (c, b) => { const d=c-b; const col = d > 0 ? 'text-bad' : 'text-ok'; return `<b class="${col}">${d>0?'+':''}${d.toFixed(2)}kg</b>`; };
                if(prevW) html+=`<span>vs Ant: ${diff(currW,prevW)}</span>`;
                html+=`<span>vs Ini (${firstW.toFixed(2)}): ${diff(currW, firstW)}</span>`;
            }
            fb.innerHTML = html;

            let dayBurned = 0;
            try {
                const wSnap = await fire.getDoc(fire.doc(db, 'entrenamientos_diarios', window.S.uid));
                if (wSnap.exists() && wSnap.data()[dStr]) {
                    wSnap.data()[dStr].forEach(w => { dayBurned += (w.kcal || 0); });
                }
            } catch(e) {}
            
            let dayBonus = dayBurned >= 350 ? dayBurned - 350 : 0;
            let dayCal=0; if(cur) MEALS.forEach(m=>{ if(cur[m.k]) cur[m.k].forEach(i=>dayCal+=i.k); });
            
            const goal = window.S.u.calc.goal;
            
           // --- PANEL DE DESGLOSE DETALLADO ---
            let breakdownBox = document.getElementById('bonus-breakdown');
            if (!breakdownBox) {
                breakdownBox = document.createElement('div');
                breakdownBox.id = 'bonus-breakdown';
                document.querySelector('.rings-container').insertAdjacentElement('beforebegin', breakdownBox);
            }

            let usedBase = Math.min(dayCal, goal);
            let remainingBase = Math.max(0, goal - dayCal);
            let usedBonus = dayCal > goal ? Math.min(dayCal - goal, dayBonus) : 0;
            let remainingBonus = Math.max(0, dayBonus - usedBonus);
            let realExcess = dayCal > (goal + dayBonus) ? dayCal - (goal + dayBonus) : 0;

            breakdownBox.innerHTML = `
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:15px; margin-bottom:20px; font-size:0.85rem;">
                    <h4 style="margin:0 0 10px 0; color:#0f172a; font-size:0.95rem; text-align:center;">🔍 Desglose Calórico Diario</h4>
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px; color:#3b82f6;"><span>🎯 Meta Base Estricta:</span> <b>${goal} kcal</b></div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px; color:#8b5cf6;"><span>🍽️ Consumido de la Base:</span> <b>${Math.round(usedBase)} kcal</b></div>
                    ${remainingBase > 0 ? `<div style="display:flex; justify-content:space-between; margin-bottom:5px; color:#3b82f6;"><span>✅ Base Restante:</span> <b>${Math.round(remainingBase)} kcal</b></div>` : ''}
                    
                    <div style="height:1px; background:#e2e8f0; margin:8px 0;"></div>
                    
                    ${dayBonus > 0 ? `
                        <div style="display:flex; justify-content:space-between; margin-bottom:5px; color:#10b981;"><span>🏃‍♂️ Bonus Ejercicio Ganado:</span> <b>+${Math.round(dayBonus)} kcal</b></div>
                        ${usedBonus > 0 ? `<div style="display:flex; justify-content:space-between; margin-bottom:5px; color:#059669;"><span>⚠️ Bonus Consumido:</span> <b>${Math.round(usedBonus)} kcal</b></div>` : ''}
                        ${remainingBonus > 0 ? `<div style="display:flex; justify-content:space-between; margin-bottom:5px; color:#10b981;"><span>🎁 Bonus Restante:</span> <b>${Math.round(remainingBonus)} kcal</b></div>` : ''}
                    ` : `<div style="display:flex; justify-content:center; margin-bottom:5px; color:#94a3b8; font-style:italic;">Sin bonus de ejercicio hoy</div>`}
                    
                    ${realExcess > 0 ? `
                        <div style="height:1px; background:#e2e8f0; margin:8px 0;"></div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:5px; color:#ef4444; font-size:0.95rem;"><span>🚨 Exceso Real:</span> <b>+${Math.round(realExcess)} kcal</b></div>
                    ` : ''}
                    <div style="margin-top:10px; text-align:center; font-weight:800; font-size:1.05rem; color:#0f172a;">TOTAL INGERIDO: ${Math.round(dayCal)} kcal</div>
                </div>
            `;
            breakdownBox.style.display = 'block';

            // --- GRÁFICO TIPO DONUT MULTI-CAPA (DIARIO) ---
            const ctxD = document.getElementById('chart-daily');
            if(window.Stats.chartDaily) window.Stats.chartDaily.destroy();
            
            document.getElementById('daily-txt').innerHTML=`
                <span class="srt-val" style="line-height:1">${Math.round(dayCal)}</span>
                <span class="srt-lbl">de ${goal} Base</span>
            `;

            let outerSum = Math.max(goal, dayCal);
            let datasetOuter = {
                data: [usedBase, remainingBase, realExcess > 0 ? realExcess : 0],
                backgroundColor: ['#8b5cf6', '#3b82f6', '#ef4444'], // Morado(Usado), Azul(Libre), Rojo(Exceso)
                borderWidth: 1, borderColor: '#ffffff'
            };
            let datasets = [datasetOuter];

            if (dayBonus > 0) {
                let dummySpace = outerSum - usedBonus - remainingBonus;
                let datasetInner = {
                    data: [usedBonus, remainingBonus, dummySpace],
                    backgroundColor: ['#059669', '#10b981', 'transparent'], // VerdeOscuro(Usado), VerdeNormal(Libre)
                    borderWidth: 1, borderColor: '#ffffff',
                    weight: 0.4
                };
                if (realExcess > 0) datasetInner.backgroundColor = ['#ef4444', 'transparent', 'transparent'];
                datasets.push(datasetInner);
            }

            window.Stats.chartDaily = new Chart(ctxD, { 
                type:'doughnut', 
                data:{ datasets: datasets }, 
                options:{ cutout:'60%', plugins:{legend:{display:false}}, animation: false } 
            });
            // --- GRÁFICO SEMANAL (El que había desaparecido) ---
            const dObj = new Date(dStr); const dayNum = dObj.getDay()||7; dObj.setDate(dObj.getDate()-dayNum+1);
            let wCal=0, wGoal=goal*7;
            for(let i=0;i<7;i++){ const tD=new Date(dObj); tD.setDate(dObj.getDate()+i); const k=tD.toISOString().split('T')[0]; const h=hist.find(x=>x.id===k); if(h) MEALS.forEach(m=>{if(h[m.k]) h[m.k].forEach(x=>wCal+=x.k)}); }
            if(window.Stats.chartWeekly) window.Stats.chartWeekly.destroy();
            window.Stats.chartWeekly = new Chart(document.getElementById('chart-weekly'), { type:'doughnut', data:{labels:['S','R'],datasets:[{data:[wCal, Math.max(0, wGoal-wCal)], backgroundColor:['#8b5cf6','#e2e8f0']}]}, options:{cutout:'75%', plugins:{legend:{display:false}}} });
            document.getElementById('weekly-txt').innerHTML=`<span class="srt-val">${Math.round(wCal)}</span><span class="srt-lbl">de ${wGoal}</span>`;

            // --- GRÁFICO EVOLUCIÓN PESO (El que había desaparecido) ---
            const cD=[], cW=[]; for(let i=29; i>=0; i--) { const tD=new Date(dStr); tD.setDate(tD.getDate()-i); const k=tD.toISOString().split('T')[0]; cD.push(k.slice(5)); const h=hist.find(x=>x.id===k); cW.push(h?h.weight:null); }
            if(window.Stats.chartWeight) window.Stats.chartWeight.destroy();
            const canvasW = document.getElementById('chart-weight'); const ctxW = canvasW.getContext('2d');
            let gradient = ctxW.createLinearGradient(0, 0, 0, canvasW.parentElement.clientHeight || 200);
            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.4)'); gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

            window.Stats.chartWeight = new Chart(ctxW, { 
                type:'line', data:{ labels:cD, datasets:[{ label:'Peso (kg)', data:cW, borderColor:'#10b981', backgroundColor: gradient, fill: true, tension:0.4, spanGaps:true, borderWidth: 3, pointRadius: 0, pointHoverRadius: 6, pointHitRadius: 15 }] }, 
                options:{ plugins:{ legend:{display:false}, tooltip: { mode: 'index', intersect: false, backgroundColor: '#0f172a', titleFont: { size: 13 }, bodyFont: { size: 14, weight: 'bold' }, padding: 10, cornerRadius: 8, displayColors: false } }, interaction: { mode: 'index', intersect: false }, maintainAspectRatio:false,
                    onHover: (event) => { event.native.target.style.cursor = 'pointer'; },
                    onClick: () => { window.Stats.openWeightDetail(); }
                } 
            });
        } catch(e) { console.error("Stats:", e); }
    },
    
    openWeightDetail: async () => {
        document.getElementById('loading-screen').style.display = 'flex';
        try {
            const q = await fire.getDocs(fire.query(fire.collection(db, `usuarios/${window.S.uid}/diario`), fire.orderBy('__name__')));
            const histW = []; 
            const histWaist = [];
            
            q.forEach(x => { 
                if(x.data().weight) histW.push({ id: x.id, w: x.data().weight }); 
                if(x.data().waist) histWaist.push({ id: x.id, waist: x.data().waist }); 
            });
            
            if(histW.length < 2) {
                alert("Registra al menos 2 pesos en días distintos para ver el análisis avanzado.");
                document.getElementById('loading-screen').style.display = 'none'; return;
            }

            const first = histW[0]; const last = histW[histW.length - 1];
            const d1 = new Date(first.id); const today = new Date();
            const daysTotal = Math.max(1, Math.floor((today - d1) / (1000 * 60 * 60 * 24)));
            const diffTotal = last.w - first.w;
            
            const d7 = new Date(); d7.setDate(d7.getDate() - 7); const d7Str = d7.toISOString().split('T')[0];
            let w7 = first.w; for(let i = histW.length - 1; i >= 0; i--) { if(histW[i].id <= d7Str) { w7 = histW[i].w; break; } }
            const diff7 = last.w - w7;
            const avgW = (daysTotal >= 7) ? (diffTotal / (daysTotal / 7)) : diffTotal;
            
            let maxW = histW[0].w, minW = histW[0].w; histW.forEach(x => { if(x.w > maxW) maxW = x.w; if(x.w < minW) minW = x.w; });

            const h_m = window.S.u.h / 100;
            const firstIMC = first.w / (h_m * h_m);
            const currentIMC = last.w / (h_m * h_m);
            const w7IMC = w7 / (h_m * h_m);
            const diffIMCTotal = currentIMC - firstIMC;
            const diffIMC7 = currentIMC - w7IMC;

            const targetW = window.S.u.tw || 75;
            document.getElementById('wf-target-w').innerText = targetW;
            let targetText = "--";
            
            const dailyRate = diffTotal / daysTotal;
            if (dailyRate < -0.005 && last.w > targetW) { 
                const kilosFaltan = targetW - last.w; 
                const daysLeft = kilosFaltan / dailyRate; 
                const projDate = new Date(); 
                projDate.setDate(projDate.getDate() + daysLeft);
                targetText = projDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
            } else if (last.w <= targetW) { targetText = "¡Logrado! 🎉"; } else { targetText = "Estancado o subiendo"; }

            const fd = (d) => `<span style="color:${d > 0 ? '#ef4444' : '#10b981'}; font-weight:900;">${d > 0 ? '+' : ''}${d.toFixed(1)}</span>`;

            document.getElementById('wf-total-lbl').innerText = `Total (${daysTotal} días)`;
            document.getElementById('wf-total-val').innerHTML = fd(diffTotal) + 'kg';
            document.getElementById('wf-7d-val').innerHTML = fd(diff7) + 'kg';
            document.getElementById('wf-avg-val').innerHTML = fd(avgW) + 'kg';
            
            document.getElementById('wf-imc-ini').innerText = firstIMC.toFixed(1);
            document.getElementById('wf-imc-val').innerText = currentIMC.toFixed(1);
            document.getElementById('wf-imc-total').innerHTML = fd(diffIMCTotal);
            document.getElementById('wf-imc-7d').innerHTML = fd(diffIMC7);
            document.getElementById('wf-target').innerText = targetText;

            // Gráfica de Peso
            if(window.Stats.chartFull) window.Stats.chartFull.destroy();
            const canvasCtx = document.getElementById('chart-weight-full').getContext('2d');
            let grad = canvasCtx.createLinearGradient(0, 0, 0, 300);
            grad.addColorStop(0, 'rgba(37, 99, 235, 0.3)'); grad.addColorStop(1, 'rgba(37, 99, 235, 0.0)');

            window.Stats.chartFull = new Chart(canvasCtx, {
                type: 'line', data: { labels: histW.map(x => { const parts = x.id.split('-'); return `${parts[2]}/${parts[1]}`; }), datasets: [{ label: 'Peso (kg)', data: histW.map(x => x.w), borderColor: '#2563eb', backgroundColor: grad, fill: true, tension: 0.4, borderWidth: 3, pointRadius: 4, pointBackgroundColor: 'white', pointBorderWidth: 2, pointHoverRadius: 7 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, backgroundColor: '#0f172a', padding: 12, titleFont: { size: 14 }, bodyFont: { size: 15, weight: 'bold' } } }, interaction: { mode: 'index', intersect: false }, scales: { y: { min: Math.floor(minW - 2), max: Math.ceil(maxW + 2) } } }
            });

            // Gráfica de Cintura (Si hay datos)
            if(window.Stats.chartWaistFull) window.Stats.chartWaistFull.destroy();
            if(histWaist.length > 0) {
                const canvasWaistCtx = document.getElementById('chart-waist-full').getContext('2d');
                let gradWaist = canvasWaistCtx.createLinearGradient(0, 0, 0, 300);
                gradWaist.addColorStop(0, 'rgba(139, 92, 246, 0.3)'); gradWaist.addColorStop(1, 'rgba(139, 92, 246, 0.0)');
                
                let maxWaist = histWaist[0].waist, minWaist = histWaist[0].waist; histWaist.forEach(x => { if(x.waist > maxWaist) maxWaist = x.waist; if(x.waist < minWaist) minWaist = x.waist; });

                window.Stats.chartWaistFull = new Chart(canvasWaistCtx, {
                    type: 'line', data: { labels: histWaist.map(x => { const parts = x.id.split('-'); return `${parts[2]}/${parts[1]}`; }), datasets: [{ label: 'Cintura (cm)', data: histWaist.map(x => x.waist), borderColor: '#8b5cf6', backgroundColor: gradWaist, fill: true, tension: 0.4, borderWidth: 3, pointRadius: 4, pointBackgroundColor: 'white', pointBorderWidth: 2, pointHoverRadius: 7 }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, backgroundColor: '#0f172a', padding: 12, titleFont: { size: 14 }, bodyFont: { size: 15, weight: 'bold' } } }, interaction: { mode: 'index', intersect: false }, scales: { y: { min: Math.floor(minWaist - 2), max: Math.ceil(maxWaist + 2) } } }
                });
            }

            window.UI.open('m-weight-full');
        } catch(e) { console.error(e); }
        document.getElementById('loading-screen').style.display = 'none';
    }
};

// --- 9. AI ---
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
        if (first === -1 || last === -1) throw new Error("IA no devolvió lista válida.");
        return JSON.parse(clean.substring(first, last + 1));
    },
    process: async () => {
        const k = localStorage.getItem('t_ai_key'), t = document.getElementById('ai-text').value; if(!k) return window.UI.view('v-conf');
        document.getElementById('loading-screen').style.display='flex';
        try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${k}`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ contents: [{ parts: [{ text: `Analiza: "${t}". Extrae alimentos y devuelve SOLO un array JSON: [{"n":"Nombre","q":100,"u":"g","k":kcal_total,"p":pro,"c":carb,"f":fat}]` }] }] })
            });
            const d = await r.json(); 
            if(!d.candidates) throw new Error("Error API");
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
            try {
                const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${k}`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ contents: [{ parts: [{ text: "Analiza la etiqueta nutricional y resume TODO en un ÚNICO alimento. NO listes nutrientes sueltos (como grasa o sodio) como elementos separados. Devuelve un array JSON con 1 solo objeto: [{'n':'Nombre del producto','q':100,'u':'g','k':calorias_totales,'p':proteinas_totales,'c':carbohidratos_totales,'f':grasas_totales}]" }, { inline_data: { mime_type: file.type, data: reader.result.split(',')[1] } }] }] })
                });
                const d = await r.json();
                if(!d.candidates) throw new Error("Error Imagen");
                const items = window.AI.cleanAndParse(d.candidates[0].content.parts[0].text);
                items.forEach(i => window.S.day[window.S.tm].push(i));
                await window.DB.setDay(); window.UI.closeAll(); window.Sys.sync();
            } catch(e) { alert("Error: " + e.message); }
            document.getElementById('loading-screen').style.display='none';
        };
    }
};

document.getElementById('qty-in').addEventListener('input', window.Logic.updateCalculations);
document.getElementById('unit-in').addEventListener('change', window.Logic.updateUnitDisplay);

if (document.readyState === 'complete') window.Sys.init(); else window.addEventListener('load', window.Sys.init);