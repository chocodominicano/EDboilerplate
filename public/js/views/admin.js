import { apiGet, apiPost, apiPut, apiDelete } from '../api.js';
import { esc, toast, confirmDialog, openModal } from '../ui.js';
import { state } from '../state.js';

let tab = null;
let selectedUserId = null;
let udTab = 'info';

// Tabs disponibles según rol: los usuarios mantienen su perfil y los
// catálogos compartidos; usuarios y logs son exclusivos del admin
const TABS = {
  admin: [['usuarios', 'Usuarios'], ['categorias', 'Categorías'], ['metodos', 'Métodos de pago'], ['logs', 'Logs del sistema'], ['perfil', '👤 Mi perfil']],
  user: [['perfil', '👤 Mi perfil'], ['categorias', 'Categorías'], ['metodos', 'Métodos de pago']]
};

export async function render(el) {
  const esAdmin = state.user?.role === 'admin';
  const tabs = TABS[esAdmin ? 'admin' : 'user'];
  if (!tab || !tabs.some(([id]) => id === tab)) tab = tabs[0][0];

  el.innerHTML = `
    <div class="section-head"><h1>${esAdmin ? '🛡️ Administración' : '⚙️ Mi cuenta'}</h1></div>
    <div class="tabs">
      ${tabs.map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div id="admin-body"></div>
  `;

  el.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { tab = b.dataset.tab; render(el); };
  });

  const body = el.querySelector('#admin-body');
  if (tab === 'usuarios') await renderUsuarios(body, el);
  else if (tab === 'categorias') await renderCatalog(body, el, 'categories', 'Categorías', 'categoría');
  else if (tab === 'metodos') await renderCatalog(body, el, 'payment_methods', 'Métodos de pago', 'método');
  else if (tab === 'perfil') await renderPerfil(body, el);
  else await renderLogs(body);
}

// ─── Tab Usuarios ──────────────────────────────────────────

const ROLE_BADGE = { admin: '<span class="badge badge-q2">Administrador</span>', user: '<span class="badge badge-muted">Usuario</span>' };
const STATUS_BADGE = {
  active: '<span class="badge badge-ok">Activo</span>',
  pending: '<span class="badge badge-warn">Pendiente</span>',
  inactive: '<span class="badge badge-danger">Inactivo</span>'
};

function avatarHTML(u, size = 38) {
  return u.avatar
    ? `<img class="avatar-circle" style="width:${size}px;height:${size}px" src="${esc(u.avatar)}" alt="">`
    : `<span class="avatar-circle" style="width:${size}px;height:${size}px">${esc(u.initials || '?')}</span>`;
}

async function renderUsuarios(body, viewEl) {
  const users = await apiGet('/api/admin/users');
  const n = (s) => users.filter((u) => u.status === s).length;
  if (selectedUserId && !users.some((u) => u.id === selectedUserId)) selectedUserId = null;
  const sel = users.find((u) => u.id === selectedUserId);

  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Total</div><div class="kpi-value">${users.length}</div></div>
      <div class="kpi"><div class="kpi-label">Activos</div><div class="kpi-value pos">${n('active')}</div></div>
      <div class="kpi"><div class="kpi-label">Pendientes</div><div class="kpi-value" style="color:var(--amber)">${n('pending')}</div></div>
      <div class="kpi"><div class="kpi-label">Inactivos</div><div class="kpi-value neg">${n('inactive')}</div></div>
    </div>

    <div class="split-2">
      <div class="card">
        <div class="section-head">
          <h2>Usuarios</h2>
          <button id="new-user" class="btn btn-primary btn-sm">＋ Nuevo usuario</button>
        </div>
        <div class="user-list">
          ${users.map((u) => `
            <div class="user-row ${u.id === selectedUserId ? 'selected' : ''}" data-user="${u.id}">
              ${avatarHTML(u)}
              <div class="user-row-info">
                <strong>${esc(u.name)}</strong>
                <span class="muted small">${esc(u.email || u.username)}</span>
              </div>
              <div class="user-row-badges">
                ${ROLE_BADGE[u.role] || ''} ${STATUS_BADGE[u.status] || ''}
                ${u.status === 'pending' ? `<button class="btn btn-sm btn-success" data-approve="${u.id}">✓ Aprobar</button>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>

      <div class="card" id="user-detail">
        ${sel ? userDetailHTML(sel) : '<p class="empty-state">Selecciona un usuario para ver su detalle</p>'}
      </div>
    </div>
  `;

  body.querySelectorAll('[data-user]').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest('[data-approve]')) return;
      selectedUserId = Number(row.dataset.user);
      udTab = 'info';
      render(viewEl);
    };
  });

  body.querySelectorAll('[data-approve]').forEach((b) => {
    b.onclick = async () => {
      try {
        await apiPost(`/api/admin/users/${b.dataset.approve}/approve`);
        toast('Usuario aprobado', 'success');
        render(viewEl);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  body.querySelector('#new-user').onclick = () => openNewUserModal(viewEl);
  if (sel) bindUserDetail(body, viewEl, sel);
}

function userDetailHTML(u) {
  const isMe = u.id === state.user.id;
  return `
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">
      ${avatarHTML(u, 52)}
      <div>
        <h2 style="margin:0">${esc(u.name)}</h2>
        <span class="muted small">@${esc(u.username)} · creado ${esc((u.createdAt || '').slice(0, 10))}</span>
      </div>
    </div>
    <div class="tabs">
      <button data-udtab="info" class="${udTab === 'info' ? 'active' : ''}">👤 Datos</button>
      <button data-udtab="pass" class="${udTab === 'pass' ? 'active' : ''}">🔑 Contraseña</button>
      <button data-udtab="access" class="${udTab === 'access' ? 'active' : ''}">⚙ Acceso</button>
    </div>

    <div id="ud-info" class="${udTab === 'info' ? '' : 'hidden'}">
      <div class="form-grid">
        <label>Nombre<input type="text" id="ud-nombre" value="${esc(u.nombre || '')}" placeholder="Nombre"></label>
        <label>Apellido<input type="text" id="ud-apellido" value="${esc(u.apellido || '')}" placeholder="Apellido"></label>
        <label class="full">Nombre completo<input type="text" id="ud-name" value="${esc(u.name || '')}"></label>
        <label class="full">Correo <span class="muted small">(afecta el acceso)</span>
          <input type="text" id="ud-email" value="${esc(u.email || '')}"></label>
        <label>Teléfono<input type="text" id="ud-phone" value="${esc(u.phone || '')}"></label>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" id="ud-save-info">✓ Guardar datos</button></div>
    </div>

    <div id="ud-pass" class="${udTab === 'pass' ? '' : 'hidden'}">
      <div class="form-grid">
        <label>Nueva contraseña<input type="password" id="ud-pass1" minlength="4"></label>
        <label>Confirmar<input type="password" id="ud-pass2" minlength="4"></label>
      </div>
      <p id="ud-pass-match" class="small hidden"></p>
      <p class="muted small">Al guardar, el usuario deberá iniciar sesión nuevamente con la nueva contraseña.</p>
      <div class="modal-actions"><button class="btn btn-primary" id="ud-save-pass">🔑 Cambiar contraseña</button></div>
    </div>

    <div id="ud-access" class="${udTab === 'access' ? '' : 'hidden'}">
      <div class="form-grid">
        <label>Nombre de usuario (login)<input type="text" id="ud-username" value="${esc(u.username)}"></label>
        <label>Rol
          <select id="ud-role" ${isMe ? 'disabled title="No puedes cambiar tu propio rol"' : ''}>
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>Usuario</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
          </select>
        </label>
        <label>Estado
          <select id="ud-status" ${isMe ? 'disabled title="No puedes cambiar tu propio estado"' : ''}>
            <option value="active" ${u.status === 'active' ? 'selected' : ''}>Activo</option>
            <option value="pending" ${u.status === 'pending' ? 'selected' : ''}>Pendiente</option>
            <option value="inactive" ${u.status === 'inactive' ? 'selected' : ''}>Inactivo</option>
          </select>
        </label>
      </div>
      <div class="modal-actions">
        ${!isMe && u.role !== 'admin' ? '<button class="btn btn-danger" id="ud-delete">🗑 Eliminar</button>' : ''}
        <button class="btn btn-primary" id="ud-save-access">✓ Guardar acceso</button>
      </div>
    </div>
  `;
}

function bindUserDetail(body, viewEl, u) {
  body.querySelectorAll('[data-udtab]').forEach((b) => {
    b.onclick = () => { udTab = b.dataset.udtab; render(viewEl); };
  });

  const val = (id) => body.querySelector(`#${id}`)?.value ?? '';

  body.querySelector('#ud-save-info').onclick = async () => {
    try {
      await apiPut(`/api/admin/users/${u.id}`, {
        nombre: val('ud-nombre'), apellido: val('ud-apellido'), name: val('ud-name'),
        email: val('ud-email') || null, phone: val('ud-phone') || null
      });
      toast('Datos actualizados', 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const p1 = body.querySelector('#ud-pass1');
  const p2 = body.querySelector('#ud-pass2');
  const matchEl = body.querySelector('#ud-pass-match');
  const checkMatch = () => {
    if (!p2.value) return matchEl.classList.add('hidden');
    matchEl.classList.remove('hidden');
    const ok = p1.value === p2.value;
    matchEl.textContent = ok ? '✓ Las contraseñas coinciden' : '✗ Las contraseñas no coinciden';
    matchEl.className = `small ${ok ? 'pos' : 'neg'}`;
  };
  p1.addEventListener('input', checkMatch);
  p2.addEventListener('input', checkMatch);

  body.querySelector('#ud-save-pass').onclick = async () => {
    if (p1.value.length < 4) return toast('Mínimo 4 caracteres', 'error');
    if (p1.value !== p2.value) return toast('Las contraseñas no coinciden', 'error');
    try {
      await apiPut(`/api/admin/users/${u.id}/password`, { password: p1.value });
      toast('Contraseña actualizada', 'success');
      p1.value = ''; p2.value = ''; matchEl.classList.add('hidden');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  body.querySelector('#ud-save-access').onclick = async () => {
    const payload = { username: val('ud-username') };
    const roleSel = body.querySelector('#ud-role');
    const statusSel = body.querySelector('#ud-status');
    if (!roleSel.disabled) payload.role = roleSel.value;
    if (!statusSel.disabled) payload.status = statusSel.value;
    try {
      await apiPut(`/api/admin/users/${u.id}`, payload);
      toast('Acceso actualizado', 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const delBtn = body.querySelector('#ud-delete');
  if (delBtn) {
    delBtn.onclick = async () => {
      const ok = await confirmDialog(
        `¿Eliminar a <strong>${esc(u.name)}</strong>?<br><br>
         <span class="neg">⚠ Se borrarán TODOS sus datos financieros: transacciones,
         tarjetas, préstamos, presupuestos y configuración. Esta acción no se puede deshacer.</span>`,
        { danger: true, okLabel: 'Eliminar definitivamente' }
      );
      if (!ok) return;
      try {
        await apiDelete(`/api/admin/users/${u.id}`);
        toast('Usuario eliminado', 'success');
        selectedUserId = null;
        render(viewEl);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
}

function openNewUserModal(viewEl) {
  const m = openModal(`
    <h2>Nuevo usuario</h2>
    <form id="nu-form" class="form-grid">
      <label>Nombre<input type="text" name="nombre" required></label>
      <label>Apellido<input type="text" name="apellido" required></label>
      <label class="full">Correo (opcional)<input type="email" name="email"></label>
      <label>Contraseña<input type="password" name="password" required minlength="4"></label>
      <label>Rol
        <select name="role"><option value="user">Usuario</option><option value="admin">Administrador</option></select>
      </label>
      <label>Estado
        <select name="status"><option value="active">Activo</option><option value="pending">Pendiente</option></select>
      </label>
    </form>
    <p class="muted small">El nombre de usuario se genera automáticamente (ej. mpimentel).</p>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Cancelar</button>
      <button class="btn btn-primary" data-act="save">Crear usuario</button>
    </div>
  `);
  m.el.querySelector('[data-act="cancel"]').onclick = m.close;
  m.el.querySelector('[data-act="save"]').onclick = async () => {
    const f = new FormData(m.el.querySelector('#nu-form'));
    try {
      const u = await apiPost('/api/admin/users', {
        nombre: f.get('nombre'), apellido: f.get('apellido'),
        email: f.get('email') || undefined, password: f.get('password'),
        role: f.get('role'), status: f.get('status')
      });
      m.close();
      toast(`Usuario creado: ${u.username}`, 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ─── Tabs de catálogos ─────────────────────────────────────

async function renderCatalog(body, viewEl, table, titulo, singular) {
  const items = await apiGet(`/api/admin/${table}`);
  const esAdmin = state.user?.role === 'admin';
  body.innerHTML = `
    <div class="card">
      <h2>${titulo}</h2>
      <form id="cat-form" class="form-grid">
        <label>Nueva ${singular}<input type="text" name="nombre" required></label>
        <button type="submit" class="btn btn-primary">＋ Agregar</button>
      </form>
      <p class="muted small" style="margin:0.5rem 0 1rem">Se usan en los formularios de gastos y presupuesto.
        ${esAdmin ? `Las transacciones ya registradas conservan su texto aunque elimines una ${singular}.`
          : 'Solo el administrador puede eliminarlas.'}</p>
      ${items.length === 0 ? '<p class="empty-state">Vacío</p>' : `
      <div class="table-wrap"><table>
        <tbody>
          ${items.map((c) => `
            <tr>
              <td>${esc(c.nombre)}</td>
              <td class="right">
                <button class="btn btn-sm" data-rename="${c.id}" data-nombre="${esc(c.nombre)}">✏️</button>
                ${esAdmin ? `<button class="btn btn-sm btn-ghost" data-del="${c.id}" data-nombre="${esc(c.nombre)}">🗑</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>
  `;

  body.querySelector('#cat-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await apiPost(`/api/admin/${table}`, { nombre: new FormData(e.target).get('nombre') });
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  body.querySelectorAll('[data-rename]').forEach((b) => {
    b.onclick = async () => {
      const m = openModal(`
        <h2>Renombrar</h2>
        <label>Nombre<input type="text" id="rn-input" value="${esc(b.dataset.nombre)}"></label>
        <div class="modal-actions">
          <button class="btn" data-act="cancel">Cancelar</button>
          <button class="btn btn-primary" data-act="ok">Guardar</button>
        </div>`);
      m.el.querySelector('[data-act="cancel"]').onclick = m.close;
      m.el.querySelector('[data-act="ok"]').onclick = async () => {
        try {
          await apiPut(`/api/admin/${table}/${b.dataset.rename}`, { nombre: m.el.querySelector('#rn-input').value });
          m.close();
          render(viewEl);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    };
  });

  body.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmDialog(`¿Eliminar "${esc(b.dataset.nombre)}"?`, { danger: true, okLabel: 'Eliminar' })) return;
      try {
        await apiDelete(`/api/admin/${table}/${b.dataset.del}`);
        render(viewEl);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}

// ─── Tab Logs ──────────────────────────────────────────────

async function renderLogs(body) {
  const logs = await apiGet('/api/admin/logs?limit=200');
  body.innerHTML = `
    <div class="card">
      <h2>Logs del sistema <span class="muted small">· últimos ${logs.length}</span></h2>
      ${logs.length === 0 ? '<p class="empty-state">Sin actividad registrada</p>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Evento</th><th>Detalle</th><th>IP</th></tr></thead>
        <tbody>
          ${logs.map((l) => `
            <tr>
              <td class="muted">${esc(l.ts)}</td>
              <td>${esc(l.user || '')}</td>
              <td><span class="badge badge-muted">${esc(l.event)}</span></td>
              <td class="muted">${esc(l.detail || '')}</td>
              <td class="muted small">${esc(l.ip || '')}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>
  `;
}

// ─── Tab Mi perfil (autoservicio, cualquier rol) ───────────

async function renderPerfil(body, viewEl) {
  const u = state.user;
  body.innerHTML = `
    <div class="split-2">
      <div class="card">
        <h2>Mis datos</h2>
        <div class="avatar-picker" style="margin-bottom:0.9rem">
          <span id="pf-avatar-preview">${avatarHTML(u, 64)}</span>
          <div>
            <input type="file" id="pf-avatar" accept="image/*" class="hidden">
            <button class="btn btn-sm" id="pf-avatar-btn">📷 Cambiar foto</button>
          </div>
        </div>
        <form id="pf-form" class="form-grid">
          <label>Nombre<input type="text" name="nombre" value="${esc(u.nombre || '')}" required></label>
          <label>Apellido<input type="text" name="apellido" value="${esc(u.apellido || '')}"></label>
          <label>Correo<input type="text" name="email" value="${esc(u.email || '')}"></label>
          <label>Teléfono<input type="text" name="phone" value="${esc(u.phone || '')}"></label>
          <div class="full"><button type="submit" class="btn btn-primary">Guardar cambios</button></div>
        </form>
        <p class="muted small" style="margin-top:0.6rem">Usuario: <code>${esc(u.username)}</code> · rol ${u.role === 'admin' ? 'administrador' : 'usuario'}</p>
      </div>

      <div class="card">
        <h2>Cambiar contraseña</h2>
        <form id="pw-form" class="form-grid">
          <label class="full">Contraseña actual<input type="password" name="actual" required autocomplete="current-password"></label>
          <label>Nueva contraseña<input type="password" name="nueva" required minlength="4" autocomplete="new-password"></label>
          <label>Confirmar nueva<input type="password" name="confirmar" required autocomplete="new-password"></label>
          <p class="muted small full" id="pw-match" style="margin:0"></p>
          <div class="full"><button type="submit" class="btn btn-primary">Actualizar contraseña</button></div>
        </form>
      </div>
    </div>
  `;

  // Avatar: mismo flujo que el registro (dataURL, máx 300KB)
  let avatarData; // undefined = sin cambio
  const fileInput = body.querySelector('#pf-avatar');
  body.querySelector('#pf-avatar-btn').onclick = () => fileInput.click();
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 300 * 1024) {
      toast('La foto es muy grande (máximo 300KB)', 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      avatarData = ev.target.result;
      body.querySelector('#pf-avatar-preview').innerHTML =
        `<img class="avatar-circle" style="width:64px;height:64px" src="${avatarData}" alt="">`;
    };
    reader.readAsDataURL(file);
  });

  body.querySelector('#pf-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await apiPut('/api/auth/me', {
        nombre: String(f.get('nombre')).trim(),
        apellido: String(f.get('apellido')).trim(),
        email: String(f.get('email')).trim(),
        phone: String(f.get('phone')).trim(),
        avatar: avatarData
      });
      state.user = r.user;
      document.getElementById('topbar-user').textContent = r.user.name || r.user.username;
      toast('Perfil actualizado', 'success');
      render(viewEl);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const pwForm = body.querySelector('#pw-form');
  const pwMatch = body.querySelector('#pw-match');
  const checkMatch = () => {
    if (!pwForm.confirmar.value) { pwMatch.textContent = ''; return; }
    const ok = pwForm.nueva.value === pwForm.confirmar.value;
    pwMatch.textContent = ok ? '✓ Las contraseñas coinciden' : '✗ Las contraseñas no coinciden';
    pwMatch.style.color = ok ? 'var(--green)' : 'var(--red)';
  };
  pwForm.nueva.addEventListener('input', checkMatch);
  pwForm.confirmar.addEventListener('input', checkMatch);

  pwForm.onsubmit = async (e) => {
    e.preventDefault();
    if (pwForm.nueva.value !== pwForm.confirmar.value) {
      return toast('Las contraseñas no coinciden', 'error');
    }
    try {
      await apiPut('/api/auth/me/password', {
        currentPassword: pwForm.actual.value,
        newPassword: pwForm.nueva.value
      });
      toast('Contraseña actualizada', 'success');
      pwForm.reset();
      pwMatch.textContent = '';
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
