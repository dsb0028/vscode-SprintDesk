/** Small webview bridge; all persisted data changes are validated by the host. */
export const CALENDAR_SCRIPT = `
(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const scroll = document.getElementById('calendar-scroll');
  let activePopup = null, anchor = null, closeTimer = null, hoverTimer = null;
  let restoringFocus = false;
  function remember() {
    vscode.setState({month:document.body.dataset.month,focus:document.activeElement?.id,
      x:scroll.scrollLeft,y:window.scrollY});
  }
  function closePopup(restore = false) {
    if (activePopup) activePopup.hidden = true;
    anchor?.setAttribute('aria-expanded','false');
    if (restore) {
      restoringFocus = true;
      anchor?.focus();
      restoringFocus = false;
    }
    activePopup = null;
    anchor = null;
  }
  function position(popup, button) {
    const rect = button.getBoundingClientRect();
    popup.style.maxWidth = Math.max(160, window.innerWidth - 16) + 'px';
    const width = popup.getBoundingClientRect().width;
    popup.style.left = Math.max(8,Math.min(rect.left,window.innerWidth-width-8)) + 'px';
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    popup.style.maxHeight = Math.max(80, Math.min(350,Math.max(below,above))) + 'px';
    const height = popup.getBoundingClientRect().height;
    popup.style.top = (below >= height ? rect.bottom + 8 : Math.max(8,rect.top-height-8)) + 'px';
  }
  function openPopup(button) {
    const popup = document.getElementById(button.getAttribute('aria-controls'));
    if (!popup) return;
    if (activePopup === popup) { clearTimeout(closeTimer); return; }
    closePopup();
    anchor = button;
    activePopup = popup;
    popup.hidden = false;
    button.setAttribute('aria-expanded','true');
    position(popup,button);
  }
  function hidePreview() {
    clearTimeout(hoverTimer);
    document.getElementById('task-preview').hidden = true;
  }
  function showPreview(button) {
    hidePreview();
    hoverTimer = setTimeout(() => {
      const preview = document.getElementById('task-preview');
      preview.textContent = button.dataset.preview;
      preview.hidden = false;
      position(preview,button);
    },250);
  }
  document.addEventListener('click',event => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      if (!event.target.closest('.picker,.task-menu,.backlog-picker')) closePopup();
      return;
    }
    const action = button.dataset.action;
    if (action === 'popup') {
      if (activePopup && anchor === button) closePopup();
      else openPopup(button);
      return;
    }
    remember();
    const message = {action};
    if (button.dataset.taskId) message.taskId = button.dataset.taskId;
    if (button.dataset.sprintId) message.sprintId = button.dataset.sprintId;
    if (button.dataset.color) message.color = button.dataset.color;
    if (button.dataset.week) message.week = button.dataset.week;
    if (action === 'assignTask') message.sprintId = document.getElementById('sprint-target').value;
    closePopup();
    hidePreview();
    vscode.postMessage(message);
  });
  document.querySelectorAll('.ribbon').forEach(button => {
    button.addEventListener('mouseenter',() => openPopup(button));
    button.addEventListener('mouseleave',() => {
      closeTimer=setTimeout(() => {
        if (activePopup && !activePopup.matches(':hover') && !activePopup.contains(document.activeElement)) closePopup();
      },180);
    });
    button.addEventListener('focus',() => {if (!restoringFocus) openPopup(button);});
  });
  document.querySelectorAll('.picker').forEach(popup => {
    popup.addEventListener('mouseenter',() => clearTimeout(closeTimer));
    popup.addEventListener('mouseleave',() => {
      closeTimer=setTimeout(() => {
        if (!anchor?.matches(':hover') && !popup.contains(document.activeElement)) closePopup();
      },180);
    });
  });
  document.querySelectorAll('.card').forEach(button => {
    button.addEventListener('mouseenter',() => showPreview(button));
    button.addEventListener('mouseleave',hidePreview);
    button.addEventListener('focus',() => showPreview(button));
    button.addEventListener('blur',hidePreview);
  });
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape') {
      hidePreview();
      if (activePopup) { closePopup(true); event.preventDefault(); }
      else if (document.body.dataset.selected) vscode.postMessage({action:'clearSelection'});
    }
    if (event.key === 'ArrowDown' && anchor === document.activeElement && activePopup) {
      activePopup.querySelector('button')?.focus();
      event.preventDefault();
    }
    else if (activePopup && (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        && activePopup.contains(document.activeElement)) {
      const buttons=[...activePopup.querySelectorAll('button:not(:disabled)')];
      const next=(buttons.indexOf(document.activeElement)+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
      buttons[next]?.focus();
      event.preventDefault();
    }
  });
  document.addEventListener('focusin',event => {
    if (activePopup && event.target!==anchor && !activePopup.contains(event.target)) closePopup();
  });
  window.addEventListener('resize',() => {closePopup();hidePreview();});
  scroll.addEventListener('scroll',() => {remember();closePopup();hidePreview();},{passive:true});
  window.addEventListener('scroll',() => {remember();closePopup();hidePreview();},{passive:true});
  requestAnimationFrame(() => {
    const sameMonth=saved.month===document.body.dataset.month;
    document.getElementById(document.body.dataset.focus || (sameMonth?saved.focus:'') || '')?.focus({preventScroll:true});
    scroll.scrollLeft=sameMonth?Number(saved.x)||0:0;
    window.scrollTo(0,sameMonth?Number(saved.y)||0:0);
    document.getElementById('month-announcement').textContent=document.getElementById('month-heading').textContent;
  });
})();
`;
